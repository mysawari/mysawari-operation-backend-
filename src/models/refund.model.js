import mongoose from "mongoose";

const refundSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  amount: { type: Number, required: true },
  reason: { type: String },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'refunded'], default: 'pending' },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // The operation member who handled it
  processedAt: { type: Date },
  customerMobile: { type: String }, // To easily trigger Firebase push notification
}, {
  timestamps: true,
});

export default mongoose.model('Refund', refundSchema);
