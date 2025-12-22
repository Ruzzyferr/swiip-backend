import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, name: "swiip-backend", timestamp: new Date().toISOString() });
});

export default router;

