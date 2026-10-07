const fs = require('fs');

const screenPath = '/Users/anisulislam/Desktop/Mysawari customer + Operation App/Operation APP/my-sawari-backend/app/menu/payments/pendingPaymentsScreen.jsx';
let content = fs.readFileSync(screenPath, 'utf8');

const newHeader = `
  const Header = () => (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Text style={styles.backButtonText}>‹</Text>
      </Pressable>
      <View style={styles.headerContent}>
        <Text style={styles.headerTitle}>Pending Payments</Text>
        <Text style={styles.headerSubtitle}>All pending collection summaries</Text>
      </View>
    </View>
  );

  if (loading) {
`;

// Replace the render part:
content = content.replace(/if\s*\(loading\)\s*\{/s, newHeader);

const newRender = `
  return (
    <SafeAreaView style={styles.container}>
      <Header />

      <View style={styles.tabsContainer}>
`;

content = content.replace(/return\s*\(\s*<SafeAreaView style=\{styles\.safeArea\}>\s*<View style=\{styles\.header\}>\s*<Text style=\{styles\.title\}>.*?<\/View>\s*<View style=\{styles\.tabsContainer\}>/s, newRender.trim());

const newStyles = `
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E7E9ED",
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F5F6F8",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  backButtonText: {
    fontSize: 24,
    color: "#111827",
    lineHeight: 28,
    marginLeft: -2,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#6B7280",
  },
  tabsContainer: {
`;

content = content.replace(/const styles = StyleSheet\.create\(\{.*?tabsContainer:/s, newStyles);

fs.writeFileSync(screenPath, content);
console.log("Updated pendingPaymentsScreen.jsx styles and Header");
