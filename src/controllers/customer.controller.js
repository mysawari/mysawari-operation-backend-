import Handover from "../models/handover.model.js";
import CustomerModel from "../models/customer.model.js";

export const updateCustomerWallet = async (req, res) => {
  try {
    const { id } = req.params;
    const { walletBalance, rewardsPoints } = req.body;

    const customer = await CustomerModel.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer App Account not found. They must sign up in the Customer App first." });
    }

    if (walletBalance !== undefined) customer.walletBalance = Number(walletBalance);
    if (rewardsPoints !== undefined) customer.rewardsPoints = Number(rewardsPoints);

    await customer.save();

    return res.status(200).json({ success: true, message: "Wallet updated successfully", data: customer });
  } catch (error) {
    console.error("Update Wallet Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update wallet" });
  }
};

export const getAllCustomers = async (req, res) => {
  try {
    const handovers = await Handover.find({
      isDeleted: false,
    }).sort({ createdAt: -1 });

    const dbCustomers = await CustomerModel.find({}).lean();
    const dbCustomerMap = new Map();
    dbCustomers.forEach(c => {
      if (c.mobileNumber) dbCustomerMap.set(c.mobileNumber, c);
    });

    const customerMap = new Map();

    handovers.forEach((handover) => {
      const phone = handover.customer?.mobileNumber;

      if (!phone) return;

      const existing = customerMap.get(phone);

      if (
        !existing ||
        new Date(handover.createdAt) > new Date(existing.createdAt)
      ) {
        const dbCust = dbCustomerMap.get(phone);
        customerMap.set(phone, {
          id: dbCust ? dbCust._id : handover._id,
          hasAppAccount: !!dbCust,
          walletBalance: dbCust ? (dbCust.walletBalance || 0) : 0,
          rewardsPoints: dbCust ? (dbCust.rewardsPoints || 0) : 0,
          name: handover.customer?.fullName || "-",
          phone: handover.customer?.mobileNumber || "-",
          email: handover.customer?.email || "-",
          idNo:
            handover.identity?.aadhaarNumber ||
            handover.identity?.drivingLicenseNumber ||
            "-",
          profession: handover.customer?.occupation || "-",
          status:
            handover.handoverStatus === "active"
              ? "Active"
              : "Inactive",
          avatar:
            handover.images?.customerPhoto ||
            "https://via.placeholder.com/100",
          createdAt: handover.createdAt,
        });
      }
    });

    const customers = Array.from(customerMap.values());

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    const stats = {
      total: customers.length,
      active: customers.filter(
        (customer) => customer.status === "Active"
      ).length,
      inactive: customers.filter(
        (customer) => customer.status === "Inactive"
      ).length,
      newThisMonth: customers.filter((customer) => {
        const date = new Date(customer.createdAt);

        return (
          date.getMonth() === currentMonth &&
          date.getFullYear() === currentYear
        );
      }).length,
    };

    return res.status(200).json({
      success: true,
      stats,
      data: customers,
    });
  } catch (error) {
    console.error("Get Customers Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch customers",
    });
  }
};