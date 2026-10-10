import mongoose from "mongoose";

const membershipSchema = new mongoose.Schema({
  membershipId: {
    type: String,
    required: true,
    unique: true,
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    unique: true,
  },
  customerName: {
    type: String,
  },
  createdBy: {
    type: String,
    enum: ['customer_app', 'operation_app'],
    default: 'customer_app',
  },
  plan: {
    type: String,
    enum: ['starter', 'plus', 'pro'],
    required: true,
  },
  activatedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  totalSaved: {
    type: Number,
    default: 0,
  },
  payment: {
    amount: { type: Number },
    paymentMethod: { type: String },
    paymentBreakdown: {
      cash: { type: Number, default: 0 },
      phonePe: { type: Number, default: 0 },
      razorpay: { type: Number, default: 0 }
    },
    upiLastFour: { type: String },
    paymentId: { type: String },
    transactionId: { type: String },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
    paidAt: { type: Date, default: Date.now }
  },
}, {
  timestamps: true,
});

export default mongoose.model('Membership', membershipSchema);
