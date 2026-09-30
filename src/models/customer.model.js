import mongoose from "mongoose";

const customerSchema = new mongoose.Schema({
  customerName: { type: String },
  mobileNumber: { type: String, required: true, unique: true },
  email: { type: String },
  status: { type: String, default: 'active' },
  walletBalance: { type: Number, default: 0 },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  withdrawalRequests: [{
    amount: { type: Number, required: true },
    method: { type: String, enum: ['upi', 'bank'], required: true },
    details: {
      upiId: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifsc: { type: String, trim: true },
      bankName: { type: String, trim: true },
      accountHolderName: { type: String, trim: true }
    },
    status: { type: String, enum: ['pending', 'released', 'rejected'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    releasedAt: { type: Date }
  }],
}, {
  timestamps: true,
  strict: false, // allow reading other fields just in case
});

export default mongoose.model('Customer', customerSchema);
