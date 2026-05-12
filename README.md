# 💰 Meu Sistema Financeiro

Um aplicativo web progressivo (PWA) focado no controle financeiro pessoal, gestão de investimentos e projeção de metas. Desenvolvido com uma arquitetura moderna e serverless, o sistema funciona offline e sincroniza os dados automaticamente com o Google Drive do usuário.

## ✨ Funcionalidades Principais

* 📊 **Dashboard Inteligente:** Visão geral do patrimônio, gráficos de evolução (linhas) e distribuição de ativos (rosca) gerados com `Chart.js`. Inclui cálculo automático para projeção da meta de R$ 100k baseado na média de aportes recentes.
* 🏦 **Gestão de Caixinhas (Renda Fixa):** Acompanhamento de saldos por instituição (Nubank, Mercado Pago, PicPay) com histórico detalhado de rendimentos diários e controle de saques/aportes.
* 📈 **Renda Variável:** Módulo dedicado para FIIs, Ações e Criptomoedas, controlando preço médio, cotação atual e variação percentual. Permite o registro rápido de proventos/dividendos.
* 🤝 **Controle de Empréstimos:** Gerenciamento de empréstimos concedidos a terceiros, calculando juros totais e gerando uma grade de parcelas. **Novo:** Geração automática de demonstrativos (recibos) em formato de imagem, permitindo copiar diretamente para a área de transferência ou realizar o download para envio via WhatsApp/mensagens.
* ☁️ **Cloud Sync & Versionamento (Google Drive):** Integração nativa com a API do Google Drive. O sistema salva os backups em uma pasta invisível (`Sistema Financeiro`), enviando os dados apenas quando há alterações (Delta Sync) e mantendo um histórico das últimas 5 versões para evitar perda de dados.
* 📱 **PWA & Offline-First:** Pode ser instalado no celular ou desktop. Graças ao `Service Worker` (`sw.js`), o app carrega instantaneamente mesmo sem internet (estratégia Network-First), salvando as transações no `localStorage`.
* 🌗 **Temas Light/Dark:** Interface UI/UX moderna, responsiva e com suporte nativo a modo escuro salvo na memória do navegador.

## 🛠️ Tecnologias Utilizadas

* **Front-end:** HTML5, CSS3 (com variáveis nativas e Flexbox/Grid), JavaScript (Vanilla ES6 Modular).
* **Armazenamento Local:** `Window.localStorage` gerenciado via wrapper customizado (DB Object).
* **PWA:** Web App Manifest (`manifest.json`) e Service Workers (`sw.js`).
* **APIs Externas:** Google Drive REST API v3, Google Identity Services (OAuth2) e Clipboard API nativa.
* **Bibliotecas Gráficas & Utilitários:** `Chart.js` para visualização de dados, `html2canvas` para a captura/geração de recibos em imagem e `FontAwesome` para iconografia.

## 🚀 Como Executar o Projeto

Como o projeto não depende de um back-end próprio (serverless), rodá-lo localmente é muito simples:

1. Faça o clone ou o download do repositório.
2. Abra a pasta do projeto.
3. Utilize uma extensão como o **Live Server** no VS Code, ou qualquer servidor HTTP local simples (como `python -m http.server`), para hospedar os arquivos.
   * *Nota:* APIs do Google OAuth requerem que o projeto esteja rodando via `http://localhost` ou `http://127.0.0.1` para autenticação segura no ambiente de desenvolvimento.
4. Acesse o projeto no seu navegador.

### ⚙️ Configuração da Nuvem (Google Drive API)

Para que a sincronização na nuvem funcione na sua própria hospedagem, é necessário substituir as chaves da API no arquivo `script.js`:
```javascript
// Edite a constante GOOGLE_API no arquivo script.js
const GOOGLE_API = {
    CLIENT_ID: 'SEU_CLIENT_ID_AQUI',
    API_KEY: 'SUA_API_KEY_AQUI',
    // ...
};
Você pode obter essas chaves no Google Cloud Console, ativando a Google Drive API e configurando a tela de consentimento OAuth.

📁 Estrutura do Projeto
index.html: Marcação principal, contendo todas as seções (Dashboard, Descritivos, Empréstimos, etc).

style.css: Estilização completa do sistema, incluindo classes utilitárias e paleta de cores (variáveis de escopo global para o modo claro e escuro).

script.js: Coração lógico da aplicação (Controller). Subdividido em módulos como DB, Cloud, UI, Transacoes e funções de captura de tela.

sw.js: Service Worker responsável pelo cache dos arquivos estáticos para o funcionamento offline.

manifest.json & favicon.png: Arquivos de configuração e ícone do PWA.

🔒 Privacidade e Segurança
Seus dados financeiros não passam por nenhum servidor de terceiros (além do seu próprio Google Drive). Tudo é processado localmente no navegador (Client-side) e salvo no seu localStorage. A pasta criada no Google Drive e as transações pertencem exclusivamente a você.
