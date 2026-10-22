import base64
import json
import os
import sys
import tempfile
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from backend.audio_utils import TAXA_FINAL
from backend.modelo import carregar_modelo, prever, treinar

DADOS = BASE / "backend" / "dados"
MODELOS = BASE / "backend" / "modelos"
COMANDOS = ["anotar", "gravar", "pesquisar", "pausar", "outro"]

ACOES = {
    "anotar": "Modo de anotações ativado. Pronto para registrar suas ideias.",
    "gravar": "Comando reconhecido: gravação de aula selecionada.",
    "pesquisar": "Pesquisa selecionada. Digite o tema que deseja estudar.",
    "pausar": "Pausa ativada. Respire e retome quando estiver pronto.",
    "outro": "Não reconheci um comando de estudo. Tente novamente.",
}


def _contagens():
    contagens = {}
    if DADOS.exists():
        for pasta in sorted(p for p in DADOS.iterdir() if p.is_dir()):
            contagens[pasta.name] = len(list(pasta.glob("*.wav")))
    return contagens


def _resultado():
    arquivo = MODELOS / "resultado.json"
    if not arquivo.exists():
        return None
    try:
        return json.loads(arquivo.read_text(encoding="utf-8"))
    except Exception:
        return None


def status():
    modelo, classes = carregar_modelo(MODELOS)
    return {
        "modelo": modelo is not None,
        "classes": list(classes) if classes else [],
        "contagens": _contagens(),
        "resultado": _resultado(),
    }


def _audio_do_pedido(req):
    bruto = req.get("audio") or ""
    if not bruto:
        raise ValueError("Nenhum áudio foi enviado.")
    try:
        audio = base64.b64decode(bruto, validate=True)
    except Exception:
        raise ValueError("O áudio enviado está em um formato inválido.")
    if len(audio) < 200:
        raise ValueError("O áudio enviado é curto demais. Fale por alguns segundos.")
    return audio


def salvar_exemplo(req):
    label = str(req.get("label") or "").strip()
    if label not in COMANDOS:
        raise ValueError("Classe inválida. Escolha um dos comandos disponíveis.")
    audio = _audio_do_pedido(req)

    pasta = DADOS / label
    pasta.mkdir(parents=True, exist_ok=True)
    existentes = {p.name for p in pasta.glob("*.wav")}
    indice = 1
    while f"{label}_{indice:03d}.wav" in existentes:
        indice += 1
    caminho = pasta / f"{label}_{indice:03d}.wav"
    caminho.write_bytes(audio)

    return {
        "mensagem": f"Exemplo salvo em {caminho.relative_to(BASE).as_posix()}.",
        "arquivo": caminho.name,
        "classe": label,
        "frase": (req.get("frase") or "").strip(),
        "status": status(),
    }


def prever_audio(req):
    modelo, _ = carregar_modelo(MODELOS)
    if modelo is None:
        raise ValueError("Treine a rede neural primeiro, gravando exemplos de todas as classes.")
    audio = _audio_do_pedido(req)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio)
        caminho_tmp = tmp.name
    try:
        import librosa

        sinal, _ = librosa.load(caminho_tmp, sr=TAXA_FINAL, mono=True)
    finally:
        try:
            os.unlink(caminho_tmp)
        except OSError:
            pass

    try:
        label, confianca = prever(modelo, sinal)
    except Exception as e:
        raise ValueError(f"Não foi possível analisar o áudio: {e}")

    return {
        "label": label,
        "confianca": confianca,
        "resposta": ACOES.get(label, ACOES["outro"]),
    }


def treinar_rede():
    try:
        relatorio = treinar(DADOS, MODELOS)
    except Exception as e:
        raise ValueError(str(e))
    return {"relatorio": relatorio, "status": status()}


def executar(req):
    acao = req.get("action")
    if acao == "status":
        return status()
    if acao == "salvar":
        return salvar_exemplo(req)
    if acao == "prever":
        return prever_audio(req)
    if acao == "treinar":
        return treinar_rede()
    raise ValueError("Ação desconhecida.")


def responder(resposta):
    saida = sys.stdout.buffer
    saida.write(json.dumps(resposta, ensure_ascii=False).encode("utf-8") + b"\n")
    saida.flush()


def servir():
    responder({"pronto": True})
    for bruto in sys.stdin.buffer:
        bruto = bruto.strip()
        if not bruto:
            continue
        try:
            req = json.loads(bruto.decode("utf-8"))
            resposta = executar(req)
        except Exception as e:
            resposta = {"erro": str(e)}
        responder(resposta)


def main():
    if "--serve" in sys.argv:
        servir()
        return
    try:
        req = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
        resposta = executar(req)
    except Exception as e:
        resposta = {"erro": str(e)}
    responder(resposta)


if __name__ == "__main__":
    main()
