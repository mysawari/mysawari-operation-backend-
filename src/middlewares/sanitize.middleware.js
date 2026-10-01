const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 10;

export function findForbiddenKey(value, depth = 0) {
  if (value === null || typeof value !== "object") return null;
  if (depth > MAX_DEPTH) return "(too deeply nested)";
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || FORBIDDEN_KEYS.has(key)) return key;
    const nested = findForbiddenKey(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export default function rejectOperatorKeys(req, res, next) {
  const bad =
    findForbiddenKey(req.body) ||
    findForbiddenKey(req.query) ||
    findForbiddenKey(req.params);
  if (bad) {
    const err = new Error("Invalid request");
    err.statusCode = 400;
    return next(err);
  }
  next();
}
