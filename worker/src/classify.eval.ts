/**
 * Eval suite for the AI spam classifier.
 * Runs against the deployed Worker's /admin/classify endpoint.
 *
 * Usage:
 *   ZISCUS_ADMIN_SECRET=xxx npx tsx worker/src/classify.eval.ts --endpoint https://ziscus.com
 */

const EVAL_CASES = [
  // SPAM — must be classified as spam
  { author: "Asif Ali", body: "I wanted to reach out to see if you're open to exploring ways to grow your website traffic. We offer customized SEO services that deliver measurable improvements.", expected: "spam" },
  { author: "Marketing Pro", body: "Check out our amazing deals at https://cheap-stuff.example.com! Best prices guaranteed!", expected: "spam" },
  { author: "CryptoTrader", body: "I made $5000 in one week using this trading bot. DM me for details.", expected: "spam" },
  { author: "John Smith", body: "Hi admin, our team specializes in web development and digital marketing. Let me send you a proposal.", expected: "spam" },
  { author: "Guest Blogger", body: "Would you be interested in a guest post exchange? We can provide high-quality content with a backlink to our site.", expected: "spam" },

  // LEGIT — must be classified as approve
  { author: "Sarah", body: "Great article, thanks for sharing!", expected: "approve" },
  { author: "dev_mike", body: "How does the HTMLRewriter handle concurrent requests? Does it share state across invocations?", expected: "approve" },
  { author: "Jane", body: "I think the rate limit of 30/hour is too high for smaller sites. Maybe make it configurable per deployment?", expected: "approve" },
  { author: "anonymous", body: "nice", expected: "approve" },
  { author: "Alex", body: "I wrote a similar system last year: https://myblog.dev/comments-from-scratch. Your approach to HTMLRewriter is cleaner.", expected: "approve" },
  { author: "CI Bot", body: "Build #1234 passed. All 56 tests green. Coverage: 94%.", expected: "approve" },
  { author: "skeptic", body: "I don't think zero JS is practical. What about accessibility? Screen readers need ARIA live regions for new comments.", expected: "approve" },
];

async function run() {
  const endpoint = process.argv.find((a, i) => process.argv[i - 1] === "--endpoint") ?? "https://ziscus.com";
  const secret = process.env.ZISCUS_ADMIN_SECRET;

  if (!secret) {
    console.error("Set ZISCUS_ADMIN_SECRET env var");
    process.exit(1);
  }

  console.log(`Evaluating ${EVAL_CASES.length} cases against ${endpoint}/admin/classify\n`);

  let correct = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const c of EVAL_CASES) {
    const start = Date.now();
    const res = await fetch(`${endpoint}/admin/classify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ author: c.author, body: c.body }),
    });

    if (!res.ok) {
      console.error(`  ERROR: ${res.status} ${await res.text()}`);
      continue;
    }

    const { classification } = (await res.json()) as { classification: string };
    const ms = Date.now() - start;
    const match = classification === c.expected;

    if (match) {
      correct++;
      console.log(`  ✓ ${c.expected.padEnd(7)} "${c.body.slice(0, 50)}..." (${ms}ms)`);
    } else {
      if (c.expected === "approve" && classification === "spam") falsePositives++;
      if (c.expected === "spam" && classification === "approve") falseNegatives++;
      console.log(`  ✗ expected ${c.expected}, got ${classification} — "${c.body.slice(0, 50)}..." (${ms}ms)`);
    }
  }

  console.log(`\nResults: ${correct}/${EVAL_CASES.length} correct (${Math.round(100 * correct / EVAL_CASES.length)}%)`);
  if (falsePositives) console.log(`  False positives (legit marked spam): ${falsePositives}`);
  if (falseNegatives) console.log(`  False negatives (spam marked approve): ${falseNegatives}`);

  process.exit(correct === EVAL_CASES.length ? 0 : 1);
}

run();
