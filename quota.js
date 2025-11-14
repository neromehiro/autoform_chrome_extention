(() => {
  const INSTALL_AT_KEY = "aimsalesInstallAtMs";
  const QUOTA_KEY = "aimsalesPriorityUsage";

  const get = (area, key) =>
    new Promise((resolve) => {
      if (!chrome?.storage?.[area]) return resolve(undefined);
      chrome.storage[area].get(key, (res) => resolve(res?.[key]));
    });

  const set = (area, obj) =>
    new Promise((resolve) => {
      if (!chrome?.storage?.[area]) return resolve();
      chrome.storage[area].set(obj, () => resolve());
    });

  const todayStr = (d = new Date()) => d.toISOString().slice(0, 10);
  const clampInt = (n) => Math.max(0, Math.floor(Number(n) || 0));
  const daysSince = (ms) => Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));

  async function getInstallAt() {
    let ts = await get("local", INSTALL_AT_KEY);
    if (typeof ts === "number" && ts > 0) return ts;
    ts = Date.now();
    await set("local", { [INSTALL_AT_KEY]: ts });
    return ts;
  }

  async function readUsage() {
    const today = todayStr();
    let state = await get("local", QUOTA_KEY);
    if (!state || state.date !== today) {
      state = { date: today, used: 0 };
      await set("local", { [QUOTA_KEY]: state });
    }
    return state;
  }

  async function writeUsage(next) {
    await set("local", { [QUOTA_KEY]: next });
    return next;
  }

  async function getDailyLimit(rules) {
    const installAt = await getInstallAt();
    const days = daysSince(installAt);
    const initDays = clampInt(rules?.priority?.initialDays ?? 7);
    const dailyInitial = clampInt(rules?.priority?.dailyInitial ?? 50);
    const dailyAfter = clampInt(rules?.priority?.dailyAfter ?? 10);
    if (days < initDays) return { limit: dailyInitial, kind: "initial" };
    return { limit: dailyAfter, kind: "after" };
  }

  async function remainingQuota(rules) {
    const { limit, kind } = await getDailyLimit(rules || {});
    const usage = await readUsage();
    const remaining = Number.isFinite(limit) ? Math.max(0, limit - clampInt(usage.used)) : Infinity;
    return { limit, used: clampInt(usage.used), remaining, kind };
  }

  async function consumePriority(count = 1) {
    const usage = await readUsage();
    const next = { ...usage, used: clampInt(usage.used) + clampInt(count) };
    return writeUsage(next);
  }

  self.Quota = { remainingQuota, consumePriority, getDailyLimit };
})();
