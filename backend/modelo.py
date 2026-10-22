from pathlib import Path
import json

import joblib
import numpy as np
import librosa
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

from .audio_utils import TAXA_FINAL, extrair_mfcc

ARQUIVO_MODELO = "nexo_mlp.joblib"


def _features_arquivo(path):
    audio, _ = librosa.load(path, sr=TAXA_FINAL, mono=True)
    return extrair_mfcc(audio)


def _criar_modelo(early_stopping=True):
    # MLPClassifier e uma rede neural feed-forward treinada por aprendizado supervisionado.
    return make_pipeline(
        StandardScaler(),
        MLPClassifier(hidden_layer_sizes=(64, 32), activation="relu",
                      solver="adam", max_iter=500, early_stopping=early_stopping,
                      n_iter_no_change=25, validation_fraction=0.15,
                      random_state=42)
    )


def _tamanho_teste(n_total, n_classes):
    """25% do conjunto, mas nunca menos que o numero de classes (exigencia da divisao estratificada)."""
    n_test = max(int(np.ceil(0.25 * n_total)), n_classes)
    return min(n_test, n_total - n_classes)


def _validacao_cruzada(X, y, modelo, contagem):
    folds = min(5, min(contagem.values()))
    if folds < 2:
        return None, 0
    cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)
    scores = cross_val_score(modelo, X, y, cv=cv, scoring="accuracy")
    return float(np.mean(scores)), folds


def treinar(pasta_dados, pasta_modelos):
    pasta_dados = Path(pasta_dados)
    pasta_modelos = Path(pasta_modelos)
    pasta_modelos.mkdir(parents=True, exist_ok=True)

    X, y, avisos = [], [], []
    for classe_dir in sorted(p for p in pasta_dados.iterdir() if p.is_dir()):
        classe = classe_dir.name
        for wav in sorted(classe_dir.glob("*.wav")):
            try:
                X.append(_features_arquivo(wav))
                y.append(classe)
            except Exception as e:
                avisos.append(f"Ignorado {wav.name}: {e}")

    if len(set(y)) < 2:
        raise ValueError("Grave áudios de pelo menos duas classes antes de treinar.")
    contagem = {c: y.count(c) for c in sorted(set(y))}
    if min(contagem.values()) < 2:
        raise ValueError("Grave pelo menos 2 exemplos por classe para separar treino e teste.")

    X = np.asarray(X, dtype=np.float32)
    y = np.asarray(y)
    n_test = _tamanho_teste(len(y), len(contagem))
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=n_test, random_state=42, stratify=y
    )

    # Com poucos exemplos por classe a parada antecipada nao consegue criar
    # um conjunto interno de validacao estratificado; nesse caso ela e desligada.
    early_stopping = min(contagem.values()) >= 5
    modelo = _criar_modelo(early_stopping)
    modelo.fit(X_train, y_train)
    pred = modelo.predict(X_test)

    acc = float(accuracy_score(y_test, pred))
    classes = [str(c) for c in modelo.named_steps["mlpclassifier"].classes_]
    report = classification_report(y_test, pred, labels=classes, target_names=classes, zero_division=0)
    cm = confusion_matrix(y_test, pred, labels=classes).tolist()
    media_cv, folds = _validacao_cruzada(X, y, _criar_modelo(early_stopping), contagem)

    joblib.dump(modelo, pasta_modelos / ARQUIVO_MODELO)
    (pasta_modelos / "classes.json").write_text(json.dumps(classes, ensure_ascii=False, indent=2), encoding="utf-8")

    resultado = {
        "amostras": int(len(y)), "treino": int(len(y_train)), "teste": int(len(y_test)),
        "acuracia": acc, "classes": classes, "contagem_por_classe": contagem,
        "acuracia_validacao_cruzada": media_cv, "folds": folds,
        "classification_report": report, "matriz_confusao": cm
    }
    (pasta_modelos / "resultado.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")

    linhas = [
        "Treinamento concluído.",
        f"Amostras: {len(y)} | treino: {len(y_train)} | teste: {len(y_test)}",
        f"Acurácia no conjunto de teste: {acc:.1%}",
    ]
    if media_cv is not None:
        linhas.append(f"Acurácia média na validação cruzada ({folds} dobras): {media_cv:.1%}")
    linhas += ["", "Relatório por classe:", report, f"Matriz de confusão (ordem {classes}):", str(cm)]
    if avisos:
        linhas += ["", "Avisos:"] + avisos
    linhas.append("Importante: a avaliação fica mais confiável com mais gravações variadas por classe.")
    return "\n".join(linhas)


def carregar_modelo(pasta_modelos):
    pasta_modelos = Path(pasta_modelos)
    arquivo = pasta_modelos / ARQUIVO_MODELO
    if not arquivo.exists():
        return None, None
    modelo = joblib.load(arquivo)
    classes = json.loads((pasta_modelos / "classes.json").read_text(encoding="utf-8"))
    return modelo, classes


def prever(modelo, audio):
    features = extrair_mfcc(audio).reshape(1, -1)
    probabilidades = modelo.predict_proba(features)[0]
    classes = modelo.named_steps["mlpclassifier"].classes_
    idx = int(np.argmax(probabilidades))
    return str(classes[idx]), float(probabilidades[idx])
