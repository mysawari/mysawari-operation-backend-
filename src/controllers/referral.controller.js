import Customer from "../models/customer.model.js";
import Referral from "../models/referral.model.js";
import SawariCashTransaction from "../models/sawaricash_transaction.model.js";

// @desc    Get all customers with withdrawal requests or wallet balance
// @route   GET /api/v1/referrals
// @access  Private
export const getReferralsAndWithdrawals = async (req, res) => {
  try {
    const directReferrers = await Referral.distinct("referrerId");
    const indirectReferrers = await Customer.distinct("referredBy");
    
    const allReferrerIds = [...new Set([
      ...directReferrers.map(id => id.toString()),
      ...indirectReferrers.map(id => id ? id.toString() : null).filter(Boolean)
    ])];

    const customers = await Customer.find({
      $or: [
        { "withdrawalRequests.0": { $exists: true } },
        { walletBalance: { $gt: 0 } },
        { _id: { $in: allReferrerIds } }
      ]
    }).select("customerName mobileNumber email walletBalance withdrawalRequests").lean();

    res.status(200).json({
      success: true,
      data: customers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

// @desc    Get referrals by a customer
// @route   GET /api/v1/referrals/:customerId
// @access  Private
export const getReferralsByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    
    // Direct referrals
    const directReferrals = await Referral.find({ referrerId: customerId }).lean();
    
    // Indirect signups (used referral code but weren't directly invited)
    const indirectSignups = await Customer.find({ referredBy: customerId }).lean();

    const items = directReferrals.map(r => {
      const account = indirectSignups.find(c => c.mobileNumber === r.referredMobile);
      return {
        id: String(r._id),
        referredName: account && account.customerName !== 'New Customer' ? account.customerName : (r.referredName || r.referredMobile),
        mobileNumber: r.referredMobile,
        signupAt: r.invitedAt,
        status: r.status === 'rewarded' ? 'REWARDED' : (account ? 'JOINED' : 'INVITED'),
        commissionAmount: r.commissionAmount || 0,
      };
    });

    const seenMobiles = new Set(items.map(i => i.mobileNumber));
    for (const account of indirectSignups) {
      if (!seenMobiles.has(account.mobileNumber)) {
        items.push({
          id: String(account._id),
          referredName: account.customerName !== 'New Customer' ? account.customerName : account.mobileNumber,
          mobileNumber: account.mobileNumber,
          signupAt: account.createdAt,
          status: 'JOINED',
          commissionAmount: 0,
        });
      }
    }

    items.sort((a, b) => new Date(b.signupAt) - new Date(a.signupAt));

    res.status(200).json({
      success: true,
      data: items
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

// @desc    Update withdrawal request status
// @route   PUT /api/v1/referrals/withdrawals/:customerId/:requestId
// @access  Private
export const updateWithdrawalStatus = async (req, res) => {
  try {
    const { customerId, requestId } = req.params;
    const { status } = req.body; // 'released' or 'rejected'

    if (!["released", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const request = customer.withdrawalRequests.id(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
    }

    request.status = status;
    
    if (status === "released") {
      request.releasedAt = new Date();
      // Find the pending transaction and mark it completed
      await SawariCashTransaction.updateMany(
        { customerId, status: 'pending', transactionType: 'debit' },
        { $set: { status: 'completed' } }
      );
    } else if (status === "rejected") {
      // Refund the amount to wallet
      customer.walletBalance += request.amount;
      // Mark transaction as refunded
      await SawariCashTransaction.updateMany(
        { customerId, status: 'pending', transactionType: 'debit' },
        { $set: { status: 'refunded' } }
      );
    }

    await customer.save();

    res.status(200).json({
      success: true,
      message: `Withdrawal request ${status}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};
