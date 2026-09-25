const krwFormatter = new Intl.NumberFormat("ko-KR");

function pendingValue(interaction, field, step, formatter = (value) => value) {
  if (interaction[field] !== undefined) {
    return formatter(interaction[field]);
  }
  return interaction.step === step ? "입력 대기" : "-";
}

export function renderAddInventoryCard({
  interaction,
  steps,
  prompt,
  error = null,
}) {
  const typeStep = interaction.step === steps.CUSTOM_GUITAR_TYPE
    ? steps.CUSTOM_GUITAR_TYPE
    : steps.GUITAR_TYPE;
  const lines = [
    "🎸 새 기타 등록",
    "",
    `브랜드: ${pendingValue(interaction, "brand", steps.BRAND)}`,
    `모델: ${pendingValue(interaction, "modelName", steps.MODEL)}`,
    `종류: ${pendingValue(interaction, "guitarTypeLabel", typeStep)}`,
    `매입가: ${pendingValue(
      interaction,
      "purchasePriceKrw",
      steps.PURCHASE_PRICE,
      (value) => `${krwFormatter.format(value)}원`,
    )}`,
    `예상 판매가: ${pendingValue(
      interaction,
      "expectedSalePriceKrw",
      steps.EXPECTED_SALE_PRICE,
      (value) => `${krwFormatter.format(value)}원`,
    )}`,
    "",
  ];
  if (error !== null) {
    lines.push(error, "");
  }
  lines.push(prompt);
  return lines.join("\n");
}
