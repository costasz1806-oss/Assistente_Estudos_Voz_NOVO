const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1";
const ROOT = path.resolve(__dirname, "..", "..");
const BRIDGE = path.join(ROOT, "backend", "api_bridge.py");
const VENV_PYTHON =
  process.platform === "win32"
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");
const PYTHON = fs.existsSync(VENV_PYTHON)
  ? VENV_PYTHON
  : process.platform === "win32"
    ? "python"
    : "python3";

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

let ponte = null;
let fila = Promise.resolve();
const pendentes = [];

function iniciarPonte() {
  if (ponte && !ponte.killed) return ponte;

  ponte = spawn(PYTHON, [BRIDGE, "--serve"], {
    cwd: ROOT,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  ponte.stdout.setEncoding("utf8");

  let buffer = "";
  ponte.stdout.on("data", (parte) => {
    buffer += parte;
    let quebra;
    while ((quebra = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, quebra).trim();
      buffer = buffer.slice(quebra + 1);
      if (!linha) continue;

      let dados;
      try {
        dados = JSON.parse(linha);
      } catch (e) {
        continue;
      }

      if (dados && dados.pronto) {
        console.log("  Backend Python pronto.");
        continue;
      }

      const pendente = pendentes.shift();
      if (!pendente) continue;
      clearTimeout(pendente.limite);
      if (dados && dados.erro) pendente.reject(new Error(dados.erro));
      else pendente.resolve(dados);
    }
  });

  ponte.stderr.on("data", (parte) => console.error("[python]", parte.toString().trim()));
  ponte.on("error", (erro) => console.error("[python] falha ao iniciar:", erro.message));
  ponte.on("exit", () => {
    ponte = null;
    while (pendentes.length) {
      const pendente = pendentes.shift();
      clearTimeout(pendente.limite);
      pendente.reject(new Error("O processo Python foi encerrado."));
    }
  });

  return ponte;
}

function enviarParaPonte(payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const processo = iniciarPonte();
    const limite = setTimeout(() => {
      const indice = pendentes.findIndex((p) => p.reject === reject);
      if (indice >= 0) pendentes.splice(indice, 1);
      if (processo) processo.kill();
      ponte = null;
      reject(new Error("O processamento demorou demais e foi interrompido."));
    }, timeoutMs);

    pendentes.push({ resolve, reject, limite });
    processo.stdin.write(JSON.stringify(payload) + "\n");
  });
}

function executarPonte(payload, timeoutMs = 900000) {
  const tarefa = fila.then(() => enviarParaPonte(payload, timeoutMs));
  fila = tarefa.catch(() => {});
  return tarefa;
}

function lerJson(req, limiteBytes = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on("data", (parte) => {
      tamanho += parte.length;
      if (tamanho > limiteBytes) {
        reject(new Error("O áudio enviado é grande demais."));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on("end", () => {
      try {
        const texto = Buffer.concat(partes).toString("utf8");
        resolve(JSON.parse(texto || "{}"));
      } catch (e) {
        reject(new Error("Corpo da requisição inválido."));
      }
    });
    req.on("error", reject);
  });
}

function responderJson(res, status, corpo) {
  const dados = Buffer.from(JSON.stringify(corpo), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": dados.length,
    "Cache-Control": "no-store",
  });
  res.end(dados);
}

function servirEstatico(req, res) {
  const caminhoUrl = decodeURIComponent(req.url.split("?")[0]);
  const relativo = caminhoUrl === "/" ? "index.html" : caminhoUrl.replace(/^\/+/, "");
  const arquivo = path.resolve(__dirname, relativo);

  if (!arquivo.startsWith(path.resolve(__dirname))) {
    res.writeHead(403);
    return res.end("Acesso negado.");
  }

  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Arquivo não encontrado.");
    }
    res.writeHead(200, {
      "Content-Type": TIPOS[path.extname(arquivo).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(conteudo);
  });
}

const servidor = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url.startsWith("/api/status")) {
      return responderJson(res, 200, await executarPonte({ action: "status" }, 300000));
    }

    if (req.method === "POST" && req.url.startsWith("/api")) {
      const corpo = await lerJson(req);
      return responderJson(res, 200, await executarPonte(corpo));
    }

    if (req.method === "GET") {
      return servirEstatico(req, res);
    }

    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Método não permitido.");
  } catch (e) {
    const mensagem = e && e.message ? e.message : "Erro inesperado.";
    console.error("[NEXO]", mensagem);
    responderJson(res, 500, { erro: mensagem });
  }
});

servidor.listen(PORT, HOST, () => {
  console.log("");
  console.log("  NEXO — interface web");
  console.log(`  Abra no navegador: http://${HOST}:${PORT}`);
  console.log("  Aquecendo o backend Python...");
  console.log("  Para encerrar: Ctrl + C");
  console.log("");
  iniciarPonte();
});
