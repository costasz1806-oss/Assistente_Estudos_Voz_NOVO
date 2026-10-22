from pathlib import Path
import sys
import threading
import tkinter as tk
from tkinter import messagebox, ttk

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

import numpy as np
import soundfile as sf

from backend.audio_utils import (gravar_audio, detectar_dispositivo,
                                 listar_entradas, TAXA_FINAL, DURACAO)
from backend.modelo import treinar, carregar_modelo, prever

DADOS = BASE / "backend" / "dados"
MODELOS = BASE / "backend" / "modelos"
COMANDOS = ["anotar", "gravar", "pesquisar", "pausar", "outro"]
FRASE_LIVRE = "outro (frase livre)"

ACOES = {
    "anotar": "Modo de anotações ativado. Pronto para registrar suas ideias.",
    "gravar": "Comando reconhecido: gravação de aula selecionada.",
    "pesquisar": "Pesquisa selecionada. Digite o tema que deseja estudar.",
    "pausar": "Pausa ativada. Respire e retome quando estiver pronto.",
    "outro": "Não reconheci um comando de estudo. Tente novamente."
}


class Assistente:
    def __init__(self, root):
        self.root = root
        self.root.title("NEXO | Assistente de Estudos por Voz")
        self.root.geometry("1000x700")
        self.root.minsize(850, 620)
        self.root.configure(bg="#090b18")
        self.busy = False
        self.model = None
        self.classes = None
        self._style()
        self._ui()
        self._load_model()
        self.root.protocol("WM_DELETE_WINDOW", self.close)

    def _style(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TProgressbar", troughcolor="#171a2c", background="#62eaff")

    def _ui(self):
        header = tk.Frame(self.root, bg="#090b18")
        header.pack(fill="x", padx=28, pady=(22, 10))
        tk.Label(header, text="N E X O", font=("Segoe UI", 25, "bold"),
                 fg="#65eaff", bg="#090b18").pack(anchor="w")
        tk.Label(header, text="ASSISTENTE DE ESTUDOS POR VOZ  /  REDE NEURAL",
                 font=("Consolas", 10), fg="#9ba8c7", bg="#090b18").pack(anchor="w", pady=(3, 0))

        line = tk.Frame(self.root, bg="#242943", height=1)
        line.pack(fill="x", padx=28, pady=12)

        center = tk.Frame(self.root, bg="#101429", highlightbackground="#29314f",
                          highlightthickness=1)
        center.pack(fill="x", padx=28, pady=8)
        tk.Label(center, text="CENTRAL DE COMANDO", font=("Consolas", 11, "bold"),
                 fg="#a7b8e8", bg="#101429").pack(anchor="w", padx=20, pady=(18, 4))
        self.status = tk.Label(center, text="PRONTO PARA INICIAR", font=("Segoe UI", 17, "bold"),
                               fg="#65eaff", bg="#101429")
        self.status.pack(anchor="w", padx=20, pady=5)
        self.detail = tk.Label(center, text="Grave exemplos, treine a rede e teste os comandos.",
                               font=("Segoe UI", 10), fg="#aab3ce", bg="#101429")
        self.detail.pack(anchor="w", padx=20, pady=(0, 18))

        buttons = tk.Frame(self.root, bg="#090b18")
        buttons.pack(fill="x", padx=28, pady=12)
        self.btn_record = self._button(buttons, "GRAVAR EXEMPLO", self.record_example, 0)
        self.btn_train = self._button(buttons, "TREINAR REDE", self.train_model, 1)
        self.btn_listen = self._button(buttons, "RECONHECER VOZ", self.recognize, 2)
        self.btn_test = self._button(buttons, "TESTAR MICROFONE", self.test_mic, 3)

        data = tk.Frame(self.root, bg="#101429", highlightbackground="#29314f", highlightthickness=1)
        data.pack(fill="both", expand=True, padx=28, pady=(4, 20))
        tk.Label(data, text="RESULTADO / LOG DO SISTEMA", font=("Consolas", 10, "bold"),
                 fg="#a7b8e8", bg="#101429").pack(anchor="w", padx=16, pady=(14, 6))
        self.logbox = tk.Text(data, height=10, bg="#0b1020", fg="#dce6ff",
                              insertbackground="#65eaff", relief="flat", wrap="word",
                              font=("Consolas", 10), padx=12, pady=10)
        self.logbox.pack(fill="both", expand=True, padx=14, pady=(0, 14))
        self.log("Sistema iniciado. Para começar, teste o microfone e grave exemplos de cada classe.")
        self.log("Classes: anotar, gravar, pesquisar, pausar e outro.")
        self.log("Os comandos executam respostas demonstrativas; não controlam aplicativos externos.")
        self._log_microfone()

    def _log_microfone(self):
        entradas = listar_entradas()
        indice = detectar_dispositivo()
        if indice is None:
            self.log("ERRO: nenhum dispositivo de entrada de áudio foi encontrado.")
            return
        nome = next((n for i, n in entradas if i == indice), f"dispositivo {indice}")
        self.log(f"Microfone em uso: [{indice}] {nome}")

    def _button(self, parent, text, command, col):
        btn = tk.Button(parent, text=text, command=command, bg="#18213c", fg="#65eaff",
                        activebackground="#25365c", activeforeground="white",
                        font=("Segoe UI", 9, "bold"), relief="flat", bd=0,
                        padx=13, pady=13, cursor="hand2")
        btn.grid(row=0, column=col, sticky="ew", padx=(0 if col == 0 else 8, 0))
        parent.grid_columnconfigure(col, weight=1)
        return btn

    def log(self, text):
        self.logbox.insert("end", f"> {text}\n")
        self.logbox.see("end")

    def set_status(self, status, detail=None):
        self.status.config(text=status)
        if detail:
            self.detail.config(text=detail)

    def _load_model(self):
        try:
            self.model, self.classes = carregar_modelo(MODELOS)
            if self.model is not None:
                self.log(f"Modelo carregado. Classes: {', '.join(self.classes)}")
        except Exception as e:
            self.log(f"Nenhum modelo pronto ainda: {e}")

    def _run_thread(self, label, func):
        if self.busy:
            messagebox.showinfo("NEXO", "Aguarde a operação atual terminar.")
            return
        self.busy = True
        self._lock_buttons()
        self.set_status(label, "Operação em andamento...")
        def runner():
            try:
                func()
            except Exception as e:
                self.root.after(0, lambda err=str(e): self._error(err))
            finally:
                self.root.after(0, self._unlock)
        threading.Thread(target=runner, daemon=True).start()

    def _error(self, err):
        self.log("ERRO: " + err)
        self.set_status("OPERAÇÃO NÃO CONCLUÍDA", "Confira o log abaixo.")
        messagebox.showerror("NEXO — erro", err)

    def _unlock(self):
        self.busy = False
        self.btn_record.config(state="normal")
        self.btn_train.config(state="normal")
        self.btn_listen.config(state="normal")
        self.btn_test.config(state="normal")

    def _lock_buttons(self):
        for b in (self.btn_record, self.btn_train, self.btn_listen, self.btn_test):
            b.config(state="disabled")

    def _ask_class(self):
        win = tk.Toplevel(self.root)
        win.title("Escolher comando")
        win.configure(bg="#101429")
        win.transient(self.root)
        win.grab_set()
        tk.Label(win, text="Qual comando você vai falar?", fg="#e4ecff",
                 bg="#101429", font=("Segoe UI", 12, "bold")).pack(padx=24, pady=(20, 12))
        value = tk.StringVar(value=COMANDOS[0])
        combo = ttk.Combobox(win, values=COMANDOS + [FRASE_LIVRE], textvariable=value,
                             state="readonly", width=26)
        combo.pack(padx=24, pady=6)

        frame = tk.Frame(win, bg="#101429")
        frame.pack(padx=24, pady=(8, 0), fill="x")
        tk.Label(frame, text="Frase:", fg="#aab3ce", bg="#101429").pack(side="left")
        entry = ttk.Entry(frame, width=30)
        entry.pack(side="left", padx=8, fill="x", expand=True)
        frame.pack_forget()

        def ao_mudar(event=None):
            if value.get() == FRASE_LIVRE:
                frame.pack(padx=24, pady=(8, 0), fill="x")
                entry.focus_set()
            else:
                frame.pack_forget()

        combo.bind("<<ComboboxSelected>>", ao_mudar)

        result = {"value": None}

        def ok():
            escolha = value.get()
            if escolha == FRASE_LIVRE:
                frase = entry.get().strip()
                if not frase:
                    messagebox.showwarning("NEXO", "Digite a frase que você vai falar.",
                                           parent=win)
                    return
                result["value"] = ("outro", frase)
            else:
                result["value"] = (escolha, None)
            win.destroy()

        tk.Button(win, text="CONTINUAR", command=ok, bg="#25365c", fg="white",
                  relief="flat", padx=18, pady=8).pack(pady=18)
        self.root.wait_window(win)
        return result["value"]

    def record_example(self):
        escolha = self._ask_class()
        if not escolha:
            return
        label, frase = escolha
        folder = DADOS / label
        folder.mkdir(parents=True, exist_ok=True)
        existentes = {p.name for p in folder.glob("*.wav")}
        indice = 1
        while f"{label}_{indice:03d}.wav" in existentes:
            indice += 1
        path = folder / f"{label}_{indice:03d}.wav"
        self._run_thread("AGUARDANDO ÁUDIO", lambda: self._record_worker(label, path, frase))

    def _record_worker(self, label, path, frase=None):
        self.root.after(0, lambda: self.log(f"Gravando exemplo para '{label}'. Fale agora por {DURACAO} segundos."))
        if frase:
            self.root.after(0, lambda: self.log(f"Frase esperada: \"{frase}\""))
        audio = gravar_audio(DURACAO)
        sf.write(str(path), audio, TAXA_FINAL, subtype="PCM_16")
        self.root.after(0, lambda: self.log(f"Salvo: {path.relative_to(BASE)}"))
        self.root.after(0, lambda: self.set_status("EXEMPLO SALVO", f"Classe: {label}"))

    def test_mic(self):
        self._run_thread("TESTANDO MICROFONE", self._test_mic_worker)

    def _test_mic_worker(self):
        audio = gravar_audio(DURACAO)
        pico = float(np.max(np.abs(audio))) if len(audio) else 0.0
        rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)))) if len(audio) else 0.0
        self.root.after(0, lambda: self.log(f"Microfone OK. Pico do sinal: {pico:.4f} | RMS: {rms:.4f}"))
        self.root.after(0, lambda: self.set_status("MICROFONE OK", "Captura de áudio concluída."))

    def train_model(self):
        self._run_thread("TREINANDO REDE", self._train_worker)

    def _train_worker(self):
        report = treinar(DADOS, MODELOS)
        self.model, self.classes = carregar_modelo(MODELOS)
        self.root.after(0, lambda: self.log(report))
        self.root.after(0, lambda: self.set_status("TREINAMENTO CONCLUÍDO", "Modelo salvo em backend/modelos."))

    def recognize(self):
        if self.model is None:
            messagebox.showinfo("NEXO", "Treine a rede neural primeiro. Grave exemplos de todas as classes.")
            return
        self._run_thread("OUVINDO COMANDO", self._recognize_worker)

    def _recognize_worker(self):
        audio = gravar_audio(DURACAO)
        label, confidence = prever(self.model, audio)
        response = ACOES.get(label, ACOES["outro"])
        self.root.after(0, lambda: self.log(f"Predição: {label.upper()} | confiança: {confidence:.1%}"))
        self.root.after(0, lambda: self.log(response))
        self.root.after(0, lambda: self.set_status(label.upper(), f"Confiança estimada: {confidence:.1%}"))

    def close(self):
        self.root.destroy()


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    root = tk.Tk()
    app = Assistente(root)
    root.mainloop()
