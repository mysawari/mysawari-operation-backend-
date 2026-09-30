import express from "express";
import { getReferralsAndWithdrawals, updateWithdrawalStatus, getReferralsByCustomer } from "../controllers/referral.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authMiddleware);

router.route("/").get(getReferralsAndWithdrawals);
router.route("/:customerId").get(getReferralsByCustomer);
router.route("/withdrawals/:customerId/:requestId/status").put(updateWithdrawalStatus);

export default router;
