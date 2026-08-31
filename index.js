const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const app = express();

// CORS configuration
app.use(
  cors({
    origin: "*", // Allow all origins for API access
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

const keyMap = {
  "tenant_app_kibet": process.env.PAYSTACK_SECRET_KIBET,
  "tenant_app_festo": process.env.PAYSTACK_SECRET_FESTO,
  "tenant_app_kevo": process.env.PAYSTACK_SECRET_KEVO
};

// Enhanced status mapping with user-friendly messages
const STATUS_MESSAGES = {
  abandoned: {
    message: "Payment was not completed. Please try again.",
    color: "warning",
    icon: "⏹️",
    userAction: "retry",
  },
  failed: {
    message: "Payment failed. Please check your details and try again.",
    color: "error",
    icon: "❌",
    userAction: "retry",
  },
  ongoing: {
    message:
      "Payment in progress. Please complete the authorization on your phone.",
    color: "info",
    icon: "🔄",
    userAction: "wait",
  },
  pending: {
    message: "Payment is being processed. Please wait...",
    color: "info",
    icon: "⏳",
    userAction: "wait",
  },
  processing: {
    message: "Payment is being processed. This may take a few moments.",
    color: "info",
    icon: "⚙️",
    userAction: "wait",
  },
  queued: {
    message: "Payment has been queued and will be processed shortly.",
    color: "info",
    icon: "📋",
    userAction: "wait",
  },
  reversed: {
    message:
      "Payment was reversed. Please contact support if this was unexpected.",
    color: "warning",
    icon: "↩️",
    userAction: "contact_support",
  },
  success: {
    message: "Payment successful!",
    color: "success",
    icon: "✅",
    userAction: "complete",
  },
  pay_offline: {
    message: "Please complete authorization on your mobile phone.",
    color: "info",
    icon: "📱",
    userAction: "authorize",
  },
  send_otp: {
    message: "OTP sent to your phone. Please enter it to continue.",
    color: "info",
    icon: "🔐",
    userAction: "enter_otp",
  },
};

// Enhanced payment initialization - NO AUTH
app.post("/api/initialize", async (req, res) => {
  const {
    appId,
    email,
    amount,
    phone,
    userId,
    activation_type = "account_activation",
  } = req.body;

  console.log("=== PAYMENT INITIALIZATION REQUEST ===");
  console.log("Request body:", {
    email,
    amount,
    phone,
    userId,
    activation_type,
  });

  // Basic validation
  if (!email || !amount || !phone) {
    return res.status(400).json({
      success: false,
      message: "Email, amount, and phone are required",
    });
  }

  // Validate amount
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({
      success: false,
      message: "Amount must be a positive number",
    });
  }

  try {
    // Format phone number for M-Pesa
    let formattedPhone = phone
      .toString()
      .replace(/\s+/g, "")
      .replace(/[-()]/g, "");

    if (formattedPhone.startsWith("0")) {
      formattedPhone = "+254" + formattedPhone.slice(1);
    } else if (formattedPhone.startsWith("254")) {
      formattedPhone = "+" + formattedPhone;
    }

    console.log("Formatted phone:", formattedPhone);

    // Validate M-Pesa format
    const mpesaPhoneRegex = /^\+254[17]\d{8}$/;
    if (!mpesaPhoneRegex.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Kenyan M-Pesa number. Use +2547XXXXXXXX or +2541XXXXXXXX",
      });
    }

    // Create payload
    const paystackPayload = {
      email: email,
      amount: Math.round(amountNum * 100), // Convert to cents
      currency: "KES",
      mobile_money: {
        phone: formattedPhone,
        provider: "mpesa",
      },
      metadata: {
        user_id: userId || "anonymous",
        activation_type: activation_type,
        timestamp: new Date().toISOString(),
      },
    };

    console.log("M-Pesa payload:", JSON.stringify(paystackPayload, null, 2));

    // Initialize charge
    const response = await axios.post(
      "https://api.paystack.co/charge",
      paystackPayload,
      {
        headers: {
          Authorization: `Bearer ${keyMap[appId] || process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    console.log("Paystack response:", JSON.stringify(response.data, null, 2));

    const { reference, status, display_text, message, gateway_response } =
      response.data.data;

    // Enhanced status handling
    const statusInfo = STATUS_MESSAGES[status] || {
      message: message || "Payment processing",
      color: "info",
      icon: "ℹ️",
      userAction: "wait",
    };

    const responseData = {
      success: true,
      message: statusInfo.message,
      reference: reference,
      status: status,
      display_text: display_text,
      gateway_response: gateway_response,
      status_icon: statusInfo.icon,
      status_color: statusInfo.color,
      user_action: statusInfo.userAction,
      requires_authorization: status === "pay_offline",
      requires_otp: status === "send_otp",
      timestamp: new Date().toISOString(),
      data: {
        phone: formattedPhone,
        amount: amountNum,
        currency: "KES",
        provider: "mpesa",
      },
    };

    // Note: No user activation since this is standalone API
    // You might want to implement webhook for activation

    res.status(200).json(responseData);
  } catch (error) {
    console.error("=== PAYMENT INITIALIZATION ERROR ===");

    if (error.response) {
      console.error("Paystack error:", error.response.data);

      const paystackError = error.response.data;
      let userMessage = "Payment initialization failed. Please try again.";
      let errorType = "payment_error";

      if (paystackError.message) {
        if (paystackError.message.includes("phone")) {
          userMessage =
            "Invalid phone number format. Please use +2547XXXXXXXX or 07XXXXXXXX.";
          errorType = "phone_format_error";
        } else if (paystackError.message.includes("amount")) {
          userMessage = "Invalid amount. Minimum amount is KES 10.";
          errorType = "amount_error";
        } else if (paystackError.message.includes("phone number")) {
          userMessage = "Invalid phone number. Please check and try again.";
          errorType = "phone_validation_error";
        } else {
          userMessage = paystackError.message;
        }
      }

      res.status(500).json({
        success: false,
        message: userMessage,
        error_type: errorType,
        paystack_error: paystackError,
        timestamp: new Date().toISOString(),
      });
    } else if (error.request) {
      console.error("No response received:", error.request);
      res.status(500).json({
        success: false,
        message: "No response from payment gateway. Please try again.",
        error_type: "gateway_timeout",
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error("Request setup error:", error.message);
      res.status(500).json({
        success: false,
        message: "Network error. Please check your connection and try again.",
        error_type: "network_error",
        timestamp: new Date().toISOString(),
      });
    }
  }
});

// Enhanced transaction verification - NO AUTH
app.get("/api/verify/:reference", async (req, res) => {
  const { reference } = req.params;
  const { appId } = req.query;

  console.log("=== TRANSACTION VERIFICATION ===");
  console.log("Reference:", reference);

  if (!reference) {
    return res.status(400).json({
      success: false,
      message: "Reference is required",
    });
  }

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${keyMap[appId] || process.env.PAYSTACK_SECRET_KEY}`,
        },
        timeout: 15000,
      }
    );

    console.log(
      "Verification response:",
      JSON.stringify(response.data, null, 2)
    );

    const data = response.data.data;
    const statusInfo = STATUS_MESSAGES[data.status] || STATUS_MESSAGES.pending;

    const verificationData = {
      success: true,
      paid: data.status === "success",
      status: data.status,
      message: data.gateway_response || statusInfo.message,
      status_icon: statusInfo.icon,
      status_color: statusInfo.color,
      user_action: statusInfo.userAction,
      reference: data.reference,
      amount: data.amount / 100,
      currency: data.currency,
      paid_at: data.paid_at,
      created_at: data.created_at,
      gateway_response: data.gateway_response,
      metadata: data.metadata || {},
      timestamp: new Date().toISOString(),
    };

    res.json(verificationData);
  } catch (error) {
    console.error("Verification error:", error);

    if (error.response) {
      if (error.response.status === 404) {
        return res.status(404).json({
          success: false,
          message: "Transaction not found. Invalid reference.",
          error_type: "not_found",
          timestamp: new Date().toISOString(),
        });
      }

      res.status(error.response.status).json({
        success: false,
        message: "Unable to verify transaction",
        error_type: "verification_failed",
        paystack_error: error.response.data,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Unable to verify payment status",
        error_type: "verification_error",
        timestamp: new Date().toISOString(),
      });
    }
  }
});

// Enhanced status polling endpoint - NO AUTH
app.get("/api/status/:reference", async (req, res) => {
  const { reference } = req.params;
  const { appId } = req.query;

  if (!reference) {
    return res.status(400).json({
      success: false,
      message: "Reference is required",
    });
  }

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${keyMap[appId] || process.env.PAYSTACK_SECRET_KEY}`,
        },
        timeout: 10000,
      }
    );

    const data = response.data.data;
    const statusInfo = STATUS_MESSAGES[data.status] || STATUS_MESSAGES.pending;

    const statusData = {
      success: true,
      paid: data.status === "success",
      status: data.status,
      message: data.gateway_response || statusInfo.message,
      status_icon: statusInfo.icon,
      status_color: statusInfo.color,
      user_action: statusInfo.userAction,
      can_retry: ["abandoned", "failed", "reversed"].includes(data.status),
      requires_action: ["ongoing", "pay_offline", "send_otp"].includes(
        data.status
      ),
      is_processing: ["pending", "processing", "queued"].includes(data.status),
      reference: data.reference,
      amount: data.amount / 100,
      currency: data.currency,
      timestamp: new Date().toISOString(),
    };

    res.json(statusData);
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to check payment status",
      error_type: "status_check_error",
      timestamp: new Date().toISOString(),
    });
  }
});

// Submit OTP endpoint - NO AUTH
app.post("/api/submit-otp", async (req, res) => {
  const { otp, reference } = req.body;
  const { appId } = req.query;

  console.log("=== OTP SUBMISSION ===");
  console.log("OTP for reference:", reference);

  if (!otp || !reference) {
    return res.status(400).json({
      success: false,
      message: "OTP and reference are required",
    });
  }

  try {
    const response = await axios.post(
      "https://api.paystack.co/charge/submit_otp",
      {
        otp: otp,
        reference: reference,
      },
      {
        headers: {
          Authorization: `Bearer ${keyMap[appId] || process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    console.log("OTP response:", JSON.stringify(response.data, null, 2));

    const { status, message } = response.data.data;
    const statusInfo = STATUS_MESSAGES[status] || STATUS_MESSAGES.processing;

    res.json({
      success: true,
      message: message || statusInfo.message,
      status: status,
      status_icon: statusInfo.icon,
      status_color: statusInfo.color,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("OTP submission error:", error);

    if (error.response) {
      const paystackError = error.response.data;
      res.status(500).json({
        success: false,
        message: paystackError.message || "OTP submission failed",
        error_type: "otp_error",
        paystack_error: paystackError,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Network error during OTP submission",
        error_type: "network_error",
        timestamp: new Date().toISOString(),
      });
    }
  }
});

// Webhook endpoint for Paystack (for automatic user activation)
app.post(
  "/api/webhook/paystack",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["x-paystack-signature"];
    const body = req.body;

    console.log("=== PAYSTACK WEBHOOK ===");
    console.log("Event received:", body.event);
    console.log("Data:", JSON.stringify(body.data, null, 2));

    // Verify webhook signature (recommended for production)
    // You can implement HMAC verification here

    if (body.event === "charge.success") {
      const data = body.data;

      // Here you can:
      // 1. Activate user account in your database
      // 2. Send confirmation email/SMS
      // 3. Update transaction status

      console.log("Payment successful via webhook:", {
        reference: data.reference,
        amount: data.amount,
        email: data.customer.email,
        metadata: data.metadata,
      });

      // Response to acknowledge webhook receipt
      res.json({ received: true, status: "success" });
    } else {
      console.log("Webhook event ignored:", body.event);
      res.json({ received: true, status: "ignored" });
    }
  }
);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "payment-api",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
  });
});

// API documentation endpoint
app.get("/api", (req, res) => {
  res.json({
    name: "Payment Processing API",
    version: "1.0.0",
    endpoints: [
      {
        method: "POST",
        path: "/api/initialize",
        description: "Initialize M-Pesa payment",
        required_fields: ["email", "amount", "phone"],
        optional_fields: ["userId", "activation_type"],
      },
      {
        method: "GET",
        path: "/api/verify/:reference",
        description: "Verify payment status",
      },
      {
        method: "GET",
        path: "/api/status/:reference",
        description: "Check payment status (for polling)",
      },
      {
        method: "POST",
        path: "/api/submit-otp",
        description: "Submit OTP for payment authorization",
      },
      {
        method: "POST",
        path: "/api/webhook/paystack",
        description: "Paystack webhook for payment notifications",
      },
    ],
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Payment API Server running on port ${PORT}`);
  console.log("📚 API Documentation: /api");
  console.log("❤️  Health Check: /api/health");
});
