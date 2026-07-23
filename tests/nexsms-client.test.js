import test from "node:test";
import assert from "node:assert/strict";

import { parsePremiumPrefixData } from "../shared/src/nexsms-client.js";

test("parsePremiumPrefixData keeps only normalized prefixes with stock", () => {
  assert.deepEqual(parsePremiumPrefixData({
    list: [
      { prefix: 1201, num: 76 },
      { prefix: "1202", num: "0" },
      { prefix: " 1206 ", num: "45" },
      { prefix: "", num: 10 }
    ]
  }), [
    { prefix: "1201", stock: 76 },
    { prefix: "1206", stock: 45 }
  ]);
});
