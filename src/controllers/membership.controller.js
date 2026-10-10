import Membership from "../models/membership.model.js";
import Customer from "../models/customer.model.js";

// @desc    Get all memberships
// @route   GET /api/v1/memberships
// @access  Private
export const getMemberships = async (req, res) => {
  try {
    const memberships = await Membership.find()
      .limit(500)
      .populate("customerId", "customerName mobileNumber email")
      .sort("-createdAt")
      .lean();

    res.status(200).json({
      success: true,
      count: memberships.length,
      data: memberships,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// @desc    Cancel/Delete membership
// @route   DELETE /api/v1/memberships/:id
// @access  Private
export const cancelMembership = async (req, res) => {
  try {
    const membership = await Membership.findById(req.params.id);
    if (!membership) {
      return res.status(404).json({ success: false, message: "Membership not found" });
    }
    
    // To cancel but keep the record for history, set expiresAt to now.
    // The Customer App correctly uses `new Date(mem.expiresAt) > new Date()` to check if it's active.
    await Membership.findByIdAndUpdate(req.params.id, {
      $set: { expiresAt: new Date() }
    });
    
    // We do NOT clear the membershipId from the Customer so we have the relation intact.
    
    res.status(200).json({
      success: true,
      message: "Membership cancelled successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

export const checkMembershipByPhone = async (req, res) => {
  try {
    const { mobileNumber } = req.params;
    if (!mobileNumber) {
      return res.status(400).json({ success: false, message: "Mobile number is required" });
    }

    const customer = await Customer.findOne({ mobileNumber });
    if (!customer) {
      return res.status(200).json({ success: true, data: null });
    }

    const membership = await Membership.findOne({ 
      customerId: customer._id,
      expiresAt: { $gt: new Date() }
    }).lean();

    return res.status(200).json({
      success: true,
      data: membership || null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// @desc    Create new membership manually
// @route   POST /api/v1/memberships
// @access  Private
export const createMembership = async (req, res) => {
  try {
    const { mobileNumber, customerName, plan, amount, paymentMethod, upiLastFour, paymentDate } = req.body;
    
    if (!mobileNumber || !plan || !amount || !paymentMethod) {
      return res.status(400).json({ success: false, message: "Please provide mobileNumber, plan, amount, and paymentMethod" });
    }

    if (!['starter', 'plus', 'pro'].includes(plan.toLowerCase())) {
      return res.status(400).json({ success: false, message: "Plan must be starter, plus, or pro" });
    }

    let customer = await Customer.findOne({ mobileNumber });
    
    if (!customer) {
      if (!customerName) {
        return res.status(404).json({ success: false, message: "Customer not found. Please provide a customer name to register them." });
      }
      customer = await Customer.create({
        mobileNumber,
        customerName
      });
    } else if (customerName && customer.customerName !== customerName) {
      customer.customerName = customerName;
      await customer.save();
    }

    // Check if active membership exists
    const existingMembership = await Membership.findOne({
      customerId: customer._id,
      expiresAt: { $gt: new Date() }
    });

    if (existingMembership) {
      return res.status(400).json({ success: false, message: "Customer already has an active membership" });
    }

    const membershipId = 'MEM' + Date.now() + Math.floor(Math.random() * 1000);
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const paymentBreakdown = { cash: 0, phonePe: 0, razorpay: 0 };
    if (paymentMethod.toLowerCase() === 'cash') {
      paymentBreakdown.cash = Number(amount);
    } else if (paymentMethod.toLowerCase().includes('phonepe') || paymentMethod.toLowerCase() === 'upi') {
      paymentBreakdown.phonePe = Number(amount);
    } else {
      paymentBreakdown.razorpay = Number(amount);
    }

    const membership = await Membership.create({
      membershipId,
      customerId: customer._id,
      customerName: customer.customerName || customerName || 'Unknown',
      createdBy: 'operation_app',
      plan: plan.toLowerCase(),
      activatedAt: new Date(),
      expiresAt,
      payment: {
        amount: Number(amount),
        paymentMethod: paymentMethod.toLowerCase(),
        paymentBreakdown,
        upiLastFour: upiLastFour || undefined,
        status: 'completed',
        paidAt: paymentDate ? new Date(paymentDate) : new Date()
      }
    });

    customer.membershipId = membership._id;
    await customer.save();

    res.status(201).json({
      success: true,
      data: membership,
      message: "Membership created successfully"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// @desc    Get detailed membership tracker info (history, bookings)
// @route   GET /api/v1/memberships/:id/tracker
// @access  Private
export const getMembershipTracker = async (req, res) => {
  try {
    const membership = await Membership.findById(req.params.id).populate('customerId');
    if (!membership) {
      return res.status(404).json({ success: false, message: 'Membership not found' });
    }

    let history = [];
    if (membership.customerId && membership.customerId.mobileNumber) {
      const Booking = (await import('../models/booking.model.js')).default;
      history = await Booking.find({ 
        mobileNumber: membership.customerId.mobileNumber,
        membershipDiscount: { $gt: 0 } 
      })
        .sort('-createdAt')
        .limit(100)
        .select('bookingId bookingCode fromDate toDate status payment membershipDiscount createdAt')
        .lean();
    }

    res.status(200).json({
      success: true,
      data: {
        membership,
        history
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};
