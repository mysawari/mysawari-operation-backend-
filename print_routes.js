import express from 'express';
import router from './src/routes/paymentHistory.routes.js';
router.stack.forEach(r => {
  if (r.route && r.route.path) {
    console.log(r.route.stack[0].method.toUpperCase(), r.route.path);
  }
});
