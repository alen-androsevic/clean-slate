// Fake dev server: the page reports what it found in storage, then writes some.
// Exits after the report so the wrapping clean-slate run ends.
const page = `<!doctype html><script>
  const seen = { local: localStorage.getItem("k"), session: sessionStorage.getItem("k"), cookie: document.cookie };
  localStorage.setItem("k", "old-dev-crap");
  document.cookie = "k=old-dev-crap; max-age=31536000";
  fetch("/report", { method: "POST", body: JSON.stringify(seen) });
</script>`;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (new URL(req.url).pathname === "/report") {
      console.log("REPORT " + (await req.text()));
      setTimeout(() => process.exit(0), 300);
      return new Response("ok");
    }
    return new Response(page, { headers: { "content-type": "text/html" } });
  },
});
console.log(`  ➜  Local:   \x1b[36mhttp://localhost:\x1b[1m${server.port}\x1b[22m/\x1b[39m`);
