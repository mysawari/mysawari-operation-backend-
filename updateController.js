import fs from 'fs';

const controllerPath = '/Users/anisulislam/Desktop/Mysawari customer + Operation App/Operation APP/my-sawari/src/controllers/paymentHistory.controller.js';
let content = fs.readFileSync(controllerPath, 'utf8');

const newController = `
export const getGenericPendingPayments = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 12)
    );
    const skip = (page - 1) * limit;

    const startOfYesterday = new Date();
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const allPayments = await PaymentHistory.find({
      createdAt: { $gte: startOfYesterday, $lte: endOfToday }
    })
      .populate("createdBy", "name fullName email username")
      .sort({ createdAt: -1 })
      .lean();

    const computed = allPayments.map((p) => {
      const method = String(p.paymentMethod || "").toLowerCase();
      if (method === "phonepe") return computePhonePeFields(p);
      if (method === "cash") return computePaymentFields(p);
      if (method === "mixed") {
        const cashComputed = computePaymentFields(p);
        const phonePeComputed = computePhonePeFields(p);
        return {
          ...p,
          isCollected: cashComputed.isCollected && phonePeComputed.isCollected,
          remainingAmount: cashComputed.remainingAmount + phonePeComputed.remainingAmount,
        };
      }
      return { ...p, isCollected: true, remainingAmount: 0 };
    });

    const pending = computed.filter((p) => !p.isCollected);

    const total = pending.length;
    const paginatedPayments = pending.slice(skip, skip + limit);
    const hasMore = skip + limit < total;

    return res.status(200).json({
      success: true,
      data: paginatedPayments,
      page,
      limit,
      total,
      hasMore,
    });
  } catch (error) {
    console.error("Get Generic Pending Payments Error:", error);
    next(error);
  }
};
`;

content = content + '\n' + newController;
fs.writeFileSync(controllerPath, content);
console.log("Updated paymentHistory.controller.js");
