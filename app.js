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

let app = express()
app.use('/', router)

app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(bodyParser.json())
app.use( bodyParser.urlencoded({ extended: true }) )
app.use(express.static(path.join(__dirname, 'public')))

const connection = mysql.createConnection({
  host     : '192.168.4.228',
  user     : 'invoices',
  password : 'pJS7@9IDYVo0r$yk05',
  database : 'invoices'
})
connection.connect()

// Create tables if needed
connection.query('CREATE TABLE IF NOT EXISTS clients (id int auto_increment not null, name varchar(256) character set utf8mb4 not null, primary key (id))', function (error) {
  if (error) throw error;
});
connection.query('CREATE TABLE IF NOT EXISTS emails (id int auto_increment not null, client int not null, address varchar(256) character set utf8mb4 not null, primary key (id))', function (error) {
  if (error) throw error;
});

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
  console.log("getClients")
  connection.query('SELECT * FROM clients JOIN emails ON clients.id = emails.client', function (error, results, fields) {
    if (error) throw error
      res.json(results)
  })
})
router.get('/getEvents', listEvents)
router.post('/addClient', bodyParser.urlencoded({ extended: false }), addClient)

// https://developers.google.com/calendar/quickstart/nodejs
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

function getAuth() {
  let content = fs.readFileSync('credentials.json','utf8')
  return authorize(JSON.parse(content))
}

function authorize(credentials) {
  const {client_secret, client_id, redirect_uris} = credentials.installed
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0])
  // Check if we have previously stored a token.
  let token = fs.readFileSync('token.json','utf8')
  oAuth2Client.setCredentials(JSON.parse(token))
  return oAuth2Client
}
function getAccessToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
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

function addClient(req, res, next) {
  console.log(req.body)
  console.log("name", req.body.name)
  for (let i=0; i<req.body['emails[]'].length; i++) {
    console.log("email", req.body['emails[]'][i])
  }
  connection.query('INSERT INTO clients SET ?', {name: req.body.name}, function (error, results, fields) {
    if (error) throw error
    let clientID = results.insertId
    for (let i=0; i<req.body['emails[]'].length; i++) {
      connection.query('INSERT INTO emails SET ?', {client: clientID, address: req.body['emails[]'][i]}, function (error, results, fields) {if (error) throw error})
    }
  })
  res.sendStatus(200)
}


module.exports = app
