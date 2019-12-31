const express = require('express')
const router = express.Router()
const path = require('path')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const logger = require('morgan')
const fs = require('fs')
const readline = require('readline')
const {google} = require('googleapis')
const mysql = require('mysql')
const moment = require('moment')
const multer = require('multer')
const MailComposer = require('nodemailer/lib/mail-composer')
const mime = require('mime')

const config = require('./config')

let app = express()
app.use('/', router)

app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(bodyParser.json())
app.use( bodyParser.urlencoded({ extended: true }) )
app.use(express.static(path.join(__dirname, 'public')))
app.use(multer)
const upload = multer({ dest: 'receipts/' })

const connection = mysql.createConnection({
  host     : config.mysql.host,
  user     : config.mysql.user,
  password : config.mysql.password,
  database : config.mysql.database
})
connection.connect()

// Create tables if needed
connection.query('CREATE TABLE IF NOT EXISTS clients (id int auto_increment not null, name varchar(256) character set utf8mb4 not null, rate decimal(6,2), primary key (id))', function (error) {
  if (error) throw error;
});
connection.query('CREATE TABLE IF NOT EXISTS emails (id int auto_increment not null, client int not null, address varchar(256) character set utf8mb4 not null, primary key (id))', function (error) {
  if (error) throw error;
});
connection.query('CREATE TABLE IF NOT EXISTS expenses (id int auto_increment not null, client int not null, date date not null, description varchar(256) character set utf8mb4 not null, amount decimal(6,2) not null, filepath varchar(256) character set utf8mb4, mimetype varchar(256) character set utf8mb4, primary key (id))', function (error) {if (error) throw error;});

// Load the auth token
const auth = getAuth()

// Routes
router.get('/getAuth', function(req, res, next) {
  if(typeof auth !== "undefined") {
    res.json({"authenticated": true})
  } else {
    res.json({"authenticated": false})
  }
})
router.get('/getClients', function(req, res, next) {
  connection.query('SELECT * FROM clients JOIN emails ON clients.id = emails.client', function (error, results, fields) {
    if (error) throw error
    res.json(results)
  })
})
router.get('/getClient', function(req, res, next) {
  connection.query('SELECT * FROM clients JOIN emails ON clients.id = emails.client WHERE client = '+req.query.clientID+';', function (error, results, fields) {
    if (error) throw error
    res.json(results)
  })
})
router.post('/deleteExpense', bodyParser.urlencoded({ extended: false }), deleteExpense)
router.post('/addClient', bodyParser.urlencoded({ extended: false }), addClient)
router.post('/newRate', bodyParser.urlencoded({ extended: false }), newRate)
router.post('/newInvoice', bodyParser.urlencoded({ extended: true }), newInvoice)
router.get('/getEvents', bodyParser.urlencoded({ extended: false }), getEvents)
router.post('/newexpense', upload.single('receipt'), newExpense)
router.get('/getexpenses', getExpenses)

function getAuth() {
  let content = fs.readFileSync('credentials.json','utf8')
  return authorize(JSON.parse(content))
}

function authorize(credentials) {
  const {client_secret, client_id, redirect_uris} = credentials.installed
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0])
  // New authorization, just uncomment to use (hacky!)
  //const authUrl = oAuth2Client.generateAuthUrl({
  //    access_type: 'offline',
  //    scope: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  //  })
  //console.log('Authorize this app by visiting this url:', authUrl)
  // Check if we have previously stored a token.
  let token = {}
  try {
    token = fs.readFileSync('token.json','utf8')
  } catch {
    return getAccessToken(oAuth2Client)
  }
  oAuth2Client.setCredentials(JSON.parse(token))
  return oAuth2Client
}
// If not access token is present, run once from the console to save token, then quit and re-run
function getAccessToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  })
  console.log('Authorize this app by visiting this url:', authUrl)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close()
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err)
      oAuth2Client.setCredentials(token)
      // Store the token to disk for later program executions
      fs.writeFile('token.json', JSON.stringify(token), (err) => {
        if (err) return console.error(err)
        console.log('Token stored to', 'token.json')
      })
    })
  })
}

function listEvents(req, res, next) {
  const calendar = google.calendar({version: 'v3', auth})
  let a = calendar.events.list({
    calendarId: 'primary',
    timeMin: (new Date()).toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  })
  res.json(a.items)
}

function newExpense(req, res, next) {
  console.log("newExpense req:", req.body)
  
  let date = moment(req.body.date, "YYYY-MM-DD")
  let description = req.body.description
  let amount = req.body.amount
  let client = req.body.client
  let filename = ""
  if (typeof req.file !== "undefined") {
    if (typeof req.file.filename !== "undefined" && req.file.mimetype !== "undefined") {
      filename = req.file.filename
      mimetype = req.file.mimetype
      connection.query('INSERT INTO expenses SET ?', {client: client, date: date.format('YYYY-MM-DD'), description: description, amount: amount, filepath: filename, mimetype: mimetype}, function (error, results, fields) {
        if (error) throw error
        res.sendStatus(200)
      })
    }
  } else {
    connection.query('INSERT INTO expenses SET ?', {client: client, date: date.format('YYYY-MM-DD'), description: description, amount: amount}, function (error, results, fields) {
      if (error) throw error
      res.sendStatus(200)
    })
  }
}

function deleteExpense(req, res, next) {
  console.log("deleteExpense:", req.body)
  console.log(parseInt(req.body.id), typeof parseInt(req.body.id))
  if (typeof parseInt(req.body.id) !== 'number') return res.sendStatus(500)
  connection.query('DELETE FROM expenses WHERE id = '+req.body.id+';', function (error, results, fields) {
    if (error) throw error
    res.sendStatus(200)
  })
}

function getExpenses(req, res, next) {
  console.log(req.query)
  connection.query('SELECT * FROM expenses WHERE client = '+req.query.clientID+';', function (error, results, fields) {
    if (error) throw error
    console.log(results)
    res.json(results)
  })
}

function newInvoice(req, res, next) {
  console.log(req.body)
  let toString = ""
  let clientName = ""
  for (let i=0; i<req.body.emails.length; i++) {
    if (typeof req.body.emails[i].address !== "undefined") {
      toString += '<' + req.body.emails[i].address + '>'
      if ((i+1) !== req.body.emails.length) toString += ', '
      clientName = req.body.emails[i].name
    }
  }
  let dateRangeString = ""
  let startDate = moment(req.body.startDate, "YYYY-MM-DD")
  let endDate = moment(req.body.endDate, "YYYY-MM-DD")
  if (startDate.year() === endDate.year()) {
    dateRangeString += startDate.format("MMM D") + " – "
  } else {
    dateRangeString += startDate.format("MMM D, YYYY") + " – "
  }
  if (startDate.month() === endDate.month()) {
    dateRangeString += endDate.format("D, YYYY")
  } else {
    dateRangeString += endDate.format("MMM D, YYYY")
  }
  const subject = 'Childcare summary for '+dateRangeString
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

  const gmail = google.gmail({version: 'v1', auth})
    
  //NEW
  let mailHtml = '<p>Hi '+clientName+',</p><p>Here\'s the childcare summary for '+dateRangeString+':</p><p style="font-family: Consolas, Monaco, monospace; white-space: pre;" id=invoiceTable>'+req.body.table+'</p><p>Best,</p><p>Lillie</p>'
  let mailText = mailHtml.replace(/<(?:.|\n)*?>/gm, '')
  let attachments = []
  let thisAttachment = {}
  if (typeof req.body.expenses === "object") {
    for (let i = 0; i < req.body.expenses.length; i++) {
      if (typeof req.body.expenses[i].filepath === 'undefined') continue
      if (!req.body.expenses[i].filepath) continue
      thisAttachment = {
        filename: req.body.expenses[i].description + "." + mime.getExtension(req.body.expenses[i].mimetype),
        path: 'receipts/' + req.body.expenses[i].filepath,
        contentType: req.body.expenses[i].mimetype
      }
      attachments.push(thisAttachment)
    }
  }
  let mail = new MailComposer(
    {
      to: toString,
      text: mailText,
      html: mailHtml,
      subject: `${utf8Subject}`,
      textEncoding: "base64",
      attachments: attachments
    })  
    
  mail.compile().build( (error, msg) => {
    if (error) return console.log('Error compiling email ' + error)
    const encodedMessage = Buffer.from(msg)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    gmail.users.drafts.create({
      userId: 'me',
      resource: {
        message: {
          raw: encodedMessage
        }
      }
    }, (err, result) => {
      if (err) return console.log('Error creating draft: ', err)
      console.log("Created draft:", result.data)
    })
  })
}

function addClient(req, res, next) {
  console.log(req.body)
  console.log("name", req.body.name)
  for (let i=0; i<req.body['emails[]'].length; i++) {
    console.log("email", req.body['emails[]'][i])
  }
  connection.query('INSERT INTO clients SET ?', {name: req.body.name, rate: req.body.rate}, function (error, results, fields) {
    if (error) throw error
    let clientID = results.insertId
    if (typeof req.body['emails[]'] === "string") {
      connection.query('INSERT INTO emails SET ?', {client: clientID, address: req.body['emails[]']}, function (error, results, fields) {
        if (error) throw error
        res.sendStatus(200)
      })
    } else {
      for (let i=0; i<req.body['emails[]'].length; i++) {
        connection.query('INSERT INTO emails SET ?', {client: clientID, address: req.body['emails[]'][i]}, function (error, results, fields) {
          if (error) throw error
          if (i - 1 === req.body['emails[]'].length) res.sendStatus(200)
        })
      }
    }
  })
}

function newRate(req, res, next) {
  console.log("newRate body:")
  console.log(req.body)
  rate = parseFloat(req.body.rate)
  clientid = parseInt(req.body.client)
  console.log("rate:", rate)
  if (!Number.isInteger(clientid)) {
    console.log("ERROR: client id is not a number")
    return res.sendStatus(500)
  }
  if (clientid < 1) {
    console.log("ERROR: client id is less than 1")
    return res.sendStatus(500)
  }
  connection.query('UPDATE clients SET rate = ? WHERE id = ?', [rate, clientid], function (error, results, fields) {
    if (error) throw error
    console.log("Done setting new rate")
    console.log(error)
    console.log(results)
    console.log(fields)
    res.sendStatus(200)
  })
}

function getEvents(req, res, next) {
  let startDate = new Date(req.query.startDate+"Z"+req.query.offset)
  let endDate = new Date(req.query.endDate+"Z"+req.query.offset)
  
  console.log(req.query)
  
  const calendar = google.calendar({version: 'v3', auth})
  let a = calendar.events.list({
    calendarId: 'primary',
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 2500 // the upper limit for the API as of Dec 2019
  }).then(function(response){
    res.json(response.data.items)
  })
}


module.exports = app
