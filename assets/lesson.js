document.querySelectorAll("pre").forEach((block) => {
  const button = document.createElement("button");
  button.className = "copy";
  button.type = "button";
  button.textContent = "复制";
  button.addEventListener("click", async () => {
    const code = block.querySelector("code")?.textContent || block.textContent;
    await navigator.clipboard.writeText(code.trim());
    button.textContent = "已复制";
    setTimeout(() => { button.textContent = "复制"; }, 1200);
  });
  block.append(button);
});

const checks = [...document.querySelectorAll("[data-lesson-check]")];
const bar = document.querySelector("[data-progress]");
const output = document.querySelector("[data-progress-label]");
function refreshProgress() {
  const done = checks.filter((item) => item.checked).length;
  const percent = checks.length ? Math.round(done / checks.length * 100) : 0;
  if (bar) bar.style.width = `${percent}%`;
  if (output) output.textContent = `${done}/${checks.length} 已完成`;
}
checks.forEach((item) => item.addEventListener("change", refreshProgress));
refreshProgress();
