# Roteiro breve para apresentação

## Objetivo
Construir um assistente que identifica comandos de voz relacionados aos estudos.

## Aprendizado supervisionado
Cada gravação recebe um rótulo conhecido (`anotar`, `gravar`, `pesquisar`, `pausar` ou `outro`). O modelo aprende relações entre características acústicas e esses rótulos. A classe `outro` aceita frases livres: o usuário digita a frase antes de gravar, e o arquivo é salvo na pasta `outro`.

## MFCC
Os coeficientes cepstrais em escala Mel (MFCC) resumem características do espectro sonoro de uma maneira relacionada à percepção auditiva. Neste projeto, 20 coeficientes são calculados e resumidos por média e desvio-padrão, gerando 40 números por áudio.

Antes dos MFCCs, o áudio passa por duas etapas de limpeza: o silêncio das bordas é removido e o volume é normalizado por RMS. Isso faz com que a mesma palavra dita a 30 cm ou a 1 metro do microfone produza features parecidas.

## Rede neural
A MLP usa duas camadas ocultas (64 e 32 neurônios), função ReLU e treinamento Adam. O modelo é treinado com exemplos rotulados, sobre dados normalizados por `StandardScaler`.

## Avaliação
O conjunto é separado em treino e teste de forma estratificada. O projeto exibe acurácia no conjunto de teste, acurácia média da validação cruzada com até 5 dobras, relatório por classe e matriz de confusão. A validação cruzada é a métrica mais confiável aqui: ela treina e testa em todas as amostras, sem depender de uma divisão sorteada.

A avaliação não deve ser interpretada como garantia de desempenho no mundo real, especialmente porque todos os exemplos vêm da mesma voz.

## Demonstração
1. Mostrar as classes e gravar um exemplo (o log mostra o microfone detectado e o nível do sinal).
2. Treinar a rede com os áudios coletados.
3. Reconhecer um comando ao vivo.
4. Mostrar um caso em que a previsão erra e explicar que mais dados variados ajudam.

## Limitações e melhorias
- MFCCs resumidos podem não distinguir bem palavras semelhantes.
- A divisão entre treino e teste é aleatória, então amostras da mesma pessoa aparecem nos dois conjuntos. Com outras vozes, a acurácia tende a cair.
- A validação cruzada já está implementada e ajuda a medir isso melhor.

Melhorias possíveis: gravar com mais locutores, comparar modelos (MLP, SVM, k-NN) e usar sequências de features ao longo do tempo em vez de apenas média e desvio-padrão.
