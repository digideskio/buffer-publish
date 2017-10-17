const http = require('http');
const express = require('express');
const logMiddleware = require('@bufferapp/logger/middleware');
const bugsnag = require('bugsnag');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const fs = require('fs');
const forceSSL = require('express-force-ssl');
const { join } = require('path');
const shutdownHelper = require('@bufferapp/shutdown-helper');
const { apiError } = require('./middleware');
const session = require('./lib/session');
const controller = require('./lib/controller');
const rpc = require('./rpc');
const pusher = require('./lib/pusher');

const app = express();
const server = http.createServer(app);

let staticAssets = {
  'bundle.js': '/static/bundle.js',
};

// NOTE: Bugsnag will not notify in local setup with current weback configuration
// https://docs.bugsnag.com/platforms/browsers/faq/#4-code-generated-with-eval-e-g-from-webpack
let bugsnagScript = '';

const isProduction = process.env.NODE_ENV === 'production';
app.set('isProduction', isProduction);

if (!isProduction) {
  /* eslint-disable global-require */
  const webpack = require('webpack');
  const config = require('./webpack.config.dev');
  const webpackMiddleware = require('webpack-dev-middleware');
  const webpackHotMiddleware = require('webpack-hot-middleware');
  /* eslint-enable global-require */

  const compiler = webpack(config);
  app.use(webpackMiddleware(compiler, {
    publicPath: config.output.publicPath,
  }));
  app.use(webpackHotMiddleware(compiler));
} else {
  staticAssets = JSON.parse(fs.readFileSync(join(__dirname, 'staticAssets.json'), 'utf8'));
  if (process.env.BUGSNAG_KEY) {
    bugsnag.register(process.env.BUGSNAG_KEY);
    app.set('bugsnag', bugsnag);
    // NOTE: Bugsnag will not notify in local setup with current weback configuration
    // https://docs.bugsnag.com/platforms/browsers/faq/#4-code-generated-with-eval-e-g-from-webpack
    bugsnagScript = `<script src="//d2wy8f7a9ursnm.cloudfront.net/bugsnag-3.min.js"
                              data-apikey="${process.env.BUGSNAG_KEY}"></script>`;
  }
}

const getHtml = () => fs.readFileSync(join(__dirname, 'index.html'), 'utf8')
                                    .replace('{{{bundle}}}', staticAssets['bundle.js'])
                                    .replace('{{{bugsnagScript}}}', bugsnagScript);

app.use(logMiddleware({ name: 'BufferPublish' }));
app.use(cookieParser());

// All routes after this have access to the user session
app.use(session.middleware);

app.post('/rpc', (req, res, next) => {
  rpc(req, res)
    // catch any unexpected errors
    .catch(err => next(err));
});

app.get('/health-check', controller.healthCheck);

// Pusher Auth
app.post('/pusher/auth',
  bodyParser.json(),
  bodyParser.urlencoded({ extended: false }),
  (req, res) => {
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;
    const auth = pusher.authenticate(socketId, channel);
    res.send(auth);
  },
);

app.get('*', (req, res) => {
  if (req.session && req.session.accessToken) {
    res.send(getHtml());
  } else {
    const redirect = encodeURIComponent(`https://${req.get('host')}${req.originalUrl}`);
    const accountUrl = `https://account${isProduction ? '' : '.local'}.buffer.com/login/`;
    res.redirect(`${accountUrl}?redirect=${redirect}`);
  }
});

app.use(forceSSL);
app.use(apiError);

server.listen(80, () => console.log('listening on port 80')); // eslint-disable-line

shutdownHelper.init({ server });
