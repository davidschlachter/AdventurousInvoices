module.exports = {
  apps : [{
    name: 'AdventurousInvoices',
    script: 'bin/www',
    watch: ['app.js', 'package.json', 'routes/index.js', 'public/index.html', 'public/stylesheets/style.css'],
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
