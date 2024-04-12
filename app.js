'use strict';

const App = require('./lib/App');

// if (process.env.DEBUG === '1') {
//   try {
//     require('inspector').waitForDebugger();
//   } catch (error) {
//     require('inspector').open(9229, '0.0.0.0', false);
//   }
// }

module.exports = App;
