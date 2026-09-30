import Refund from '../models/refund.model.js';
import Booking from '../models/booking.model.js';
import Customer from '../models/customer.model.js';
import User from '../models/user.model.js';

// Get all refund requests
export const getAllRefunds = async (req, res) => {
  try {
    const refunds = await Refund.find()
      .populate('bookingId')
      .populate('customerId', 'customerName mobileNumber email')
      .populate('processedBy', 'fullName')
      .sort({ createdAt: -1 });
    res.status(200).json(refunds);
  } catch (error) {
    console.error("getAllRefunds Error:", error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Create a new refund request (can be called when booking is cancelled)
export const createRefund = async (req, res) => {
  try {
    const { bookingId, customerId, amount, reason, customerMobile } = req.body;
    
    const newRefund = new Refund({
      bookingId,
      customerId,
      amount,
      reason,
      customerMobile
    });
    
    await newRefund.save();
    res.status(201).json({ message: 'Refund request created successfully', refund: newRefund });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Approve or process a refund
export const updateRefundStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'approved', 'rejected', 'refunded'
    
    const refund = await Refund.findById(id);
    if (!refund) {
      return res.status(404).json({ message: 'Refund not found' });
    }
    
    refund.status = status;
    refund.processedBy = req.user?._id; // Assuming auth middleware sets req.user
    refund.processedAt = new Date();
    
    await refund.save();
    
    res.status(200).json({ message: `Refund marked as ${status}`, refund });
  } catch (error) {
    console.error("updateRefundStatus Error:", error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
