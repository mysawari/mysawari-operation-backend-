import Membership from "../models/membership.model.js";
import Customer from "../models/customer.model.js";

// @desc    Get all memberships
// @route   GET /api/v1/memberships
// @access  Private
export const getMemberships = async (req, res) => {
  try {
    const memberships = await Membership.find()
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
