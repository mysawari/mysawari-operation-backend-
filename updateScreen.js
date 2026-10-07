const fs = require('fs');

const screenPath = '/Users/anisulislam/Desktop/Mysawari customer + Operation App/Operation APP/my-sawari-backend/app/menu/payments/pendingPaymentsScreen.jsx';
let content = fs.readFileSync(screenPath, 'utf8');

const newFetch = `
  const fetchPayments = async () => {
    try {
      setLoading(true);

      const [resCash, resPhonepe] = await Promise.all([
        api.get("/payments/pending", { params: { status: "pending", limit: 500 } }).catch(() => ({ data: { data: [] } })),
        api.get("/payments/phonepe/pending", { params: { status: "pending", limit: 500 } }).catch(() => ({ data: { data: [] } }))
      ]);

      const cashData = resCash.data?.data || [];
      const phonepeData = resPhonepe.data?.data || [];

      // Combine and deduplicate
      const combined = [...cashData, ...phonepeData];
      const uniqueMap = new Map();
      combined.forEach(p => {
        if (!uniqueMap.has(p._id)) {
          uniqueMap.set(p._id, p);
        } else {
          // If it exists (e.g. mixed payment), we want to make sure we show the true remaining amount
          // Wait, the endpoints already compute remainingAmount for their specific channels.
          // Let's just merge the remaining amounts.
          const existing = uniqueMap.get(p._id);
          existing.remainingAmount = Math.max(existing.remainingAmount, p.remainingAmount);
        }
      });

      const uniquePayments = Array.from(uniqueMap.values());
      setPayments(uniquePayments);
      setHasMore(false); // We fetched up to 500
    } catch (err) {
      console.error("Failed to load pending payments", err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };
`;

content = content.replace(/const fetchPayments = async.*?finally\s*{\s*setLoading\(false\);\s*setLoadingMore\(false\);\s*}\s*};/s, newFetch.trim());

fs.writeFileSync(screenPath, content);
console.log("Updated pendingPaymentsScreen.jsx to fetch from existing endpoints");
