import express from "express";
import protect from "../middlewares/auth.middleware.js";
import { getAllCustomers, updateCustomerWallet } from "../controllers/customer.controller.js";


const router = express.Router();

router.use(protect);

router.get("/all", getAllCustomers);
router.put("/:id/wallet", updateCustomerWallet);

export default router;