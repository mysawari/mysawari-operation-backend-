import express from "express";
import { getMemberships, cancelMembership, checkMembershipByPhone } from "../controllers/membership.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authMiddleware); // Require auth for all operations

router.route("/").get(getMemberships);
router.route("/check/:mobileNumber").get(checkMembershipByPhone);
router.route("/:id").delete(cancelMembership);

export default router;
