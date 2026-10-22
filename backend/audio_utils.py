import numpy as np
import sounddevice as sd
import librosa

TAXA_FINAL = 16000
TAXA_CAPTURA = 44100
DISPOSITIVO = 1
DURACAO = 3

TOP_DB = 35
LIMIAR_SILENCIO = 0.005
ALVO_RMS = 0.1
MINIMO_AMOSTRAS = TAXA_FINAL // 10


def listar_entradas():
    """Devolve [(indice, nome)] dos dispositivos que aceitam audio de entrada."""
    entradas = []
    try:
        dispositivos = sd.query_devices()
    except Exception:
        return entradas
    for i, d in enumerate(dispositivos):
        if d.get("max_input_channels", 0) > 0:
            nome = d.get("name", "")
            if not isinstance(nome, str):
                nome = str(nome)
            entradas.append((i, nome))
    return entradas


def detectar_dispositivo():
    """Escolhe o microfone: padrao do sistema, depois DISPOSITIVO, depois o primeiro com entrada."""
    entradas = listar_entradas()
    if not entradas:
        return None
    validos = {i for i, _ in entradas}
    try:
        padrao = sd.default.device[0]
    except Exception:
        padrao = None
    if padrao is not None and int(padrao) in validos:
        return int(padrao)
    if DISPOSITIVO in validos:
        return DISPOSITIVO
    return entradas[0][0]


def _taxa_nativa(indice):
    """Taxa de amostragem que o dispositivo realmente suporta."""
    try:
        return int(sd.query_devices(indice)["default_samplerate"])
    except Exception:
        return TAXA_CAPTURA


def gravar_audio(duracao=DURACAO, dispositivo=None):
    """Captura audio mono, reamostra para 16 kHz e devolve o sinal bruto."""
    indice = detectar_dispositivo() if dispositivo is None else dispositivo
    if indice is None:
        raise RuntimeError("Nenhum microfone de entrada foi encontrado neste computador.")

    taxa = _taxa_nativa(indice)
    frames = int(duracao * taxa)
    stream = None
    try:
        stream = sd.InputStream(
            device=indice,
            samplerate=taxa,
            channels=1,
            dtype="float32",
            blocksize=0,
        )
        stream.start()
        audio, overflow = stream.read(frames)
        if overflow:
            print("Aviso: houve overflow durante a captura.")
    finally:
        if stream is not None:
            try:
                if stream.active:
                    stream.stop()
            finally:
                stream.close()

    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    if not len(audio):
        raise RuntimeError("O microfone não retornou áudio.")
    if taxa != TAXA_FINAL:
        audio = librosa.resample(audio, orig_sr=taxa, target_sr=TAXA_FINAL)
    return np.nan_to_num(audio).astype(np.float32)


def preparar_audio(audio):
    """Remove o silencio das bordas e normaliza o volume, para o microfone importar menos."""
    audio = np.asarray(audio, dtype=np.float32)
    if audio.size == 0:
        return audio
    if float(np.max(np.abs(audio))) < LIMIAR_SILENCIO:
        return audio
    if audio.size >= 2048:
        audio, _ = librosa.effects.trim(audio, top_db=TOP_DB)
    if audio.size < MINIMO_AMOSTRAS:
        return audio
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
    if rms > LIMIAR_SILENCIO:
        audio = audio * (ALVO_RMS / rms)
        pico = float(np.max(np.abs(audio)))
        if pico > 0.99:
            audio = audio * (0.99 / pico)
    return audio.astype(np.float32)


def extrair_mfcc(audio):
    audio = preparar_audio(audio)
    if audio.size < MINIMO_AMOSTRAS:
        raise ValueError("áudio muito curto")
    mfcc = librosa.feature.mfcc(y=audio, sr=TAXA_FINAL, n_mfcc=20, n_fft=512, hop_length=160)
    # Media e desvio-padrao de cada coeficiente: vetor fixo de 40 atributos.
    return np.concatenate([mfcc.mean(axis=1), mfcc.std(axis=1)]).astype(np.float32)
