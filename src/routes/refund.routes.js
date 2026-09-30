import express from 'express';
import { getAllRefunds, createRefund, updateRefundStatus } from '../controllers/refund.controller.js';
import authMiddleware from '../middlewares/auth.middleware.js';

const router = express.Router();
router.get('/', authMiddleware, getAllRefunds);
router.post('/', authMiddleware, createRefund);
router.put('/:id', authMiddleware, updateRefundStatus);

export default router;
