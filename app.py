from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.api_bridge import executar

app = FastAPI(title="NEXO - Assistente de Estudos por Voz")


class Acao(BaseModel):
    action: str = ""
    label: str | None = None
    frase: str | None = None
    audio: str | None = None


def _resposta(payload):
    return JSONResponse(status_code=200, content=payload)


@app.get("/api/status")
def ler_status():
    try:
        return _resposta(executar({"action": "status"}))
    except Exception as erro:
        return _resposta({"erro": str(erro)})


@app.post("/api")
def executar_acao(acao: Acao):
    payload = {
        "action": acao.action,
        "label": acao.label,
        "frase": acao.frase,
        "audio": acao.audio,
    }
    try:
        return _resposta(executar(payload))
    except Exception as erro:
        return _resposta({"erro": str(erro)})


app.mount("/", StaticFiles(directory=str(BASE / "frontend" / "web"), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=3000)
