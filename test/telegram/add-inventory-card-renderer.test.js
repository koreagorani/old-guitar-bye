import assert from "node:assert/strict";
import test from "node:test";

import { ADD_STEPS } from "../../src/telegram/interactions/add-inventory-flow.js";
import { renderAddInventoryCard } from "../../src/telegram/render/add-inventory-card-renderer.js";

test("renders accumulated registration values and the current pending field", () => {
  const text = renderAddInventoryCard({
    interaction: {
      step: ADD_STEPS.GUITAR_TYPE,
      brand: "Yamaha",
      modelName: "F310",
    },
    steps: ADD_STEPS,
    prompt: "기타 종류를 선택해주세요.",
  });

  assert.match(text, /브랜드: Yamaha/);
  assert.match(text, /모델: F310/);
  assert.match(text, /종류: 입력 대기/);
  assert.match(text, /매입가: -/);
  assert.match(text, /예상 판매가: -/);
  assert.match(text, /기타 종류를 선택해주세요\./);
});
