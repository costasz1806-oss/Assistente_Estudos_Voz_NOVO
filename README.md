# NEXO — Assistente de Estudos por Voz

Projeto educacional em Python para classificar comandos de voz usando MFCCs e uma rede neural MLP com aprendizado supervisionado.

## Comandos reconhecidos
- `anotar`
- `gravar`
- `pesquisar`
- `pausar`
- `outro` (frases que não correspondem aos comandos acima)

As respostas são demonstrativas: o projeto não controla automaticamente outros aplicativos.

## Requisitos
- Windows 10/11
- Python 3.11, 3.12 ou 3.13
- Um microfone conectado (USB, headset ou integrado). O programa detecta o microfone padrão do Windows automaticamente, sem configuração manual.

## Instalação

O ambiente virtual `.venv` já está criado nesta pasta. Para apenas executar:

```powershell
.\.venv\Scripts\python.exe frontend\main.py
```

Para recriar o ambiente do zero:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python frontend\main.py
```

Se o PowerShell bloquear a ativação do ambiente, execute o Python pelo caminho `.venv\Scripts\python.exe` sem ativar o ambiente.

## Interface web (Node.js)

A pasta `frontend/web` traz uma interface web escura e interativa, servida por um servidor Node.js sem dependências externas. Ela usa o mesmo backend Python (`.venv`) e as mesmas pastas `backend/dados` e `backend/modelos`.

Requisitos: Node.js 18 ou superior.

```powershell
node frontend\web\server.js
```

Ou, dentro da pasta:

```powershell
cd frontend\web
npm start
```

Depois abra `http://127.0.0.1:3000` no navegador e permita o acesso ao microfone. O servidor aquece o backend Python na inicialização; a primeira resposta pode demorar alguns segundos por causa dos imports de librosa e scikit-learn.

A interface permite testar o microfone, gravar exemplos, treinar a rede e reconhecer comandos ao vivo, com visualizador de áudio, contagem por classe e relatório de treinamento.

## Como usar
1. Clique em **Testar microfone** para verificar a captura. O log mostra o dispositivo escolhido, o pico e o RMS do sinal.
2. Clique em **Gravar exemplo** e escolha uma classe.
3. Fale o comando assim que a captura começar. Você tem 3 segundos; o silêncio inicial e final é removido automaticamente e o volume é normalizado, então a distância do microfone tem menos efeito o resultado.
4. Grave exemplos para todas as cinco classes. Comece com pelo menos 10–20 exemplos por classe; mais exemplos variados ajudam.
5. Para a classe `outro`, use a opção **outro (frase livre)** e digite a frase que vai falar (por exemplo, "vou estudar mais tarde"). Isso treina o modelo a rejeitar frases que não são comandos, em vez de aprender apenas a palavra "outro".
6. Clique em **Treinar rede**. O programa cria `backend/modelos/nexo_mlp.joblib`, `classes.json` e `resultado.json`.
7. Clique em **Reconhecer voz** para testar a predição ao vivo.

## Método
- O áudio é capturado na taxa nativa do microfone e reamostrado para 16 kHz.
- O silêncio das bordas é removido e o sinal é normalizado por RMS antes da extração, para que o modelo dependa menos do volume e da distância do microfone.
- A librosa extrai 20 coeficientes MFCC (janela de 25 ms, passo de 10 ms). A média e o desvio-padrão de cada coeficiente formam um vetor de 40 características.
- Os dados são divididos em treino (75%) e teste (25%), mantendo a proporção das classes. Com poucas amostras, o conjunto de teste é ampliado para nunca ter menos linhas que classes.
- A rede neural MLP possui camadas ocultas de 64 e 32 neurônios, ativação ReLU e otimizador Adam, com parada antecipada.
- O resultado inclui acurácia no teste, acurácia média da validação cruzada com até 5 dobras, relatório por classe e matriz de confusão.

## Limitações
- É um protótipo didático, não um sistema de reconhecimento de fala de produção.
- MFCCs resumidos podem confundir palavras curtas com sons parecidos.
- A acurácia depende da quantidade, variedade e qualidade dos exemplos próprios.
- Todos os exemplos gravados devem ser da mesma voz: a divisão é aleatória, então amostras da mesma pessoa podem aparecer no treino e no teste. Isso torna a acurácia otimista em relação a vozes diferentes.
- Uma amostra pequena ou desequilibrada não permite concluir que o sistema funcionará para qualquer pessoa.
- A confiança da predição não é garantia de certeza.

## Estrutura
- `frontend/main.py`: interface gráfica em Tkinter.
- `frontend/web/`: interface web (HTML, CSS e JavaScript) e servidor Node.js.
- `frontend/web/server.js`: servidor local e API que conversa com o Python.
- `backend/api_bridge.py`: ponte entre a interface web e a lógica Python.
- `backend/audio_utils.py`: captura, escolha do microfone, limpeza do áudio e extração MFCC.
- `backend/modelo.py`: treinamento, avaliação e predição.
- `backend/dados/`: áudios próprios, separados por classe.
- `backend/modelos/`: modelo e relatórios gerados após treinar.
