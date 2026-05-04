/**
 * SISTEMA FINANCEIRO - ARQUITETURA MODULAR COMPLETA
 */

// ==========================================
// 1. CONFIGURAÇÕES GOOGLE DRIVE (Nuvem Visível)
// ==========================================
const GOOGLE_API = {
    CLIENT_ID: '167789619068-71draj7ofg1tphk3jdur37m7dqno868q.apps.googleusercontent.com',
    API_KEY: 'AIzaSyBebLpALlkZAWMAUxaAFz8oY9K0SoBKDHw',
    DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    // Novo escopo: Permite criar e ver arquivos que o próprio app criou no seu Drive normal
    SCOPES: 'https://www.googleapis.com/auth/drive.file', 
    FOLDER_NAME: 'Sistema Financeiro', // Nome da pasta que será criada no seu Drive
    FILE_NAME: 'financas_backup_auto.json',
    tokenClient: null,
    isLoaded: false,
    fileId: null,
    folderId: null
};

// ==========================================
// 2. DB (LocalStorage Management)
// ==========================================
const DB = {
    get: (key, fallback) => JSON.parse(localStorage.getItem(key)) || fallback,
    set: (key, data) => {
        localStorage.setItem(key, JSON.stringify(data));
        Cloud.triggerAutoSave(); 
    },
    
    getCC: () => {
        let val = localStorage.getItem('sf_conta_corrente_v2');
        return val !== null ? parseFloat(val) : 25.61;
    },
    getTransacoes: () => DB.get('sf_transacoes', []),
    getEmprestimos: () => DB.get('sf_emprestimos_v1', []),
    getAtivos: () => DB.get('sf_ativos_v1', []),
    getHistoricoPatrimonio: () => DB.get('sf_hist_patrimonio_v1', []),
    getBancos: () => {
        let bancos = DB.get('sf_saldos_bancos_v6', null);
        if (!bancos) {
            bancos = {
                nubank: { saldo: 10000.71, historico: [] },
                mp: { saldo: 9982.39, historico: [] },
                picpay: { saldo: 500.43, historico: [] }
            };
            DB.set('sf_saldos_bancos_v6', bancos);
        }
        return bancos;
    },

    setCC: (val) => {
        localStorage.setItem('sf_conta_corrente_v2', val.toString());
        Cloud.triggerAutoSave();
    },
    setTransacoes: (data) => DB.set('sf_transacoes', data),
    setEmprestimos: (data) => DB.set('sf_emprestimos_v1', data),
    setAtivos: (data) => DB.set('sf_ativos_v1', data),
    setHistoricoPatrimonio: (data) => DB.set('sf_hist_patrimonio_v1', data),
    setBancos: (data) => DB.set('sf_saldos_bancos_v6', data)
};

// ==========================================
// 3. CLOUD SYNC (MOTOR DO GOOGLE DRIVE)
// ==========================================
const Cloud = {
    saveTimeout: null,

    init() {
        if (!window.gapi || !window.google) {
            console.error("Scripts do Google não carregados.");
            return;
        }

        gapi.load('client', () => {
            gapi.client.init({
                apiKey: GOOGLE_API.API_KEY,
                discoveryDocs: [GOOGLE_API.DISCOVERY_DOC]
            }).then(() => {
                GOOGLE_API.isLoaded = true;
                
                const savedToken = sessionStorage.getItem('sf_google_token');
                if (savedToken) {
                    gapi.client.setToken({ access_token: savedToken });
                    this.onAuthenticated();
                }

            }).catch(e => console.error("Erro no GAPI", e));
        });

        GOOGLE_API.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_API.CLIENT_ID,
            scope: GOOGLE_API.SCOPES,
            callback: (tokenResponse) => {
                if (tokenResponse && tokenResponse.access_token) {
                    this.onAuthenticated();
                }
            }
        });

        document.getElementById('btn-google-login')?.addEventListener('click', () => this.login());
        document.getElementById('btn-force-sync')?.addEventListener('click', () => this.syncNow());
        document.getElementById('btn-logout')?.addEventListener('click', () => this.logout());
    },

    login() {
        if (!GOOGLE_API.tokenClient) return UI.showToast("Google Client não iniciado.", "danger");
        GOOGLE_API.tokenClient.requestAccessToken();
    },

    logout() {
        const token = gapi.client.getToken();
        if (token !== null) {
            google.accounts.oauth2.revoke(token.access_token, () => {
                gapi.client.setToken('');
                sessionStorage.removeItem('sf_google_token');
                
                document.getElementById('btn-google-login')?.classList.remove('hidden');
                document.getElementById('cloud-controls')?.classList.add('hidden');
                
                UI.showToast("Desconectado da Nuvem", "success");
            });
        }
    },

    onAuthenticated() {
        const token = gapi.client.getToken().access_token;
        sessionStorage.setItem('sf_google_token', token);
        
        document.getElementById('btn-google-login')?.classList.add('hidden');
        document.getElementById('cloud-controls')?.classList.remove('hidden');
        
        this.syncNow();
    },

    showLoading(text) {
        const overlay = document.getElementById('loading-overlay');
        const p = document.getElementById('loading-text');
        if(p) p.innerText = text;
        if(overlay) overlay.classList.remove('hidden');
    },

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if(overlay) overlay.classList.add('hidden');
    },

    triggerAutoSave() {
        if(this.saveTimeout) clearTimeout(this.saveTimeout);
        
        if(!window.gapi || !gapi.client) return;
        const token = gapi.client.getToken();
        if(!token) return;

        this.saveTimeout = setTimeout(() => {
            this.uploadToDrive(true);
        }, 3000);
    },

    // Nova função: Verifica se a pasta existe. Se não, cria a pasta.
    async getOrCreateFolder() {
        try {
            const response = await gapi.client.drive.files.list({
                q: `name='${GOOGLE_API.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id)'
            });
            if (response.result.files && response.result.files.length > 0) {
                return response.result.files[0].id;
            } else {
                const folderMetadata = {
                    name: GOOGLE_API.FOLDER_NAME,
                    mimeType: 'application/vnd.google-apps.folder'
                };
                const createRes = await gapi.client.drive.files.create({
                    resource: folderMetadata,
                    fields: 'id'
                });
                return createRes.result.id;
            }
        } catch (e) {
            console.error("Erro ao buscar/criar pasta", e);
            throw e;
        }
    },

    async syncNow() {
        if(!GOOGLE_API.isLoaded || !gapi.client.getToken()) return this.login();

        this.showLoading("Acessando Pasta...");
        
        try {
            // Pega o ID da pasta visível (ou cria se não existir)
            GOOGLE_API.folderId = await this.getOrCreateFolder();

            // Procura o arquivo JSON dentro dessa pasta específica
            const response = await gapi.client.drive.files.list({
                q: `name='${GOOGLE_API.FILE_NAME}' and '${GOOGLE_API.folderId}' in parents and trashed=false`,
                fields: 'files(id, modifiedTime)'
            });

            const files = response.result.files;

            if (files && files.length > 0) {
                GOOGLE_API.fileId = files[0].id;
                this.showLoading("Baixando dados...");
                await this.downloadFromDrive(GOOGLE_API.fileId);
            } else {
                this.showLoading("Criando backup inicial...");
                await this.uploadToDrive();
            }
            
            this.hideLoading();
            const statusLabel = document.getElementById('cloud-status');
            if(statusLabel) statusLabel.innerText = "Sincronizado: " + new Date().toLocaleTimeString();

        } catch (err) {
            console.error(err);
            this.hideLoading();
            UI.showToast("Erro ao conectar com a nuvem.", "danger");
            if(err.status === 401 || err.status === 403) {
                sessionStorage.removeItem('sf_google_token');
                this.logout();
            }
        }
    },

    async downloadFromDrive(fileId) {
        try {
            const file = await gapi.client.drive.files.get({
                fileId: fileId,
                alt: 'media'
            });

            const data = file.result;
            if(data && typeof data === 'object') {
                for (const key in data) {
                    if (key.startsWith('sf_')) {
                        localStorage.setItem(key, data[key]);
                    }
                }
                UI.showToast("Dados baixados da nuvem!", "success");
                App.updateAll();
            }
        } catch (e) {
            console.error("Erro no Download", e);
            UI.showToast("Erro ao ler dados da nuvem", "danger");
        }
    },

    async uploadToDrive(isSilent = false) {
        if(!gapi.client.getToken()) return;

        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('sf_')) data[key] = localStorage.getItem(key);
        }
        
        const fileContent = JSON.stringify(data);
        const metadata = {
            name: GOOGLE_API.FILE_NAME,
            mimeType: 'application/json'
        };

        // Se for a primeira vez (POST), salva dentro da pasta 'Sistema Financeiro'
        if (!GOOGLE_API.fileId && GOOGLE_API.folderId) {
            metadata.parents = [GOOGLE_API.folderId];
        }

        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        const multipartRequestBody =
            delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            fileContent +
            close_delim;

        try {
            const method = GOOGLE_API.fileId ? 'PATCH' : 'POST';
            const path = GOOGLE_API.fileId ? `/upload/drive/v3/files/${GOOGLE_API.fileId}` : '/upload/drive/v3/files';

            const request = gapi.client.request({
                path: path,
                method: method,
                params: { uploadType: 'multipart' },
                headers: {
                    'Content-Type': 'multipart/related; boundary="' + boundary + '"'
                },
                body: multipartRequestBody
            });

            const res = await request;
            GOOGLE_API.fileId = res.result.id;

            if(!isSilent) UI.showToast("Backup salvo na nuvem!", "success");
            
            const statusLabel = document.getElementById('cloud-status');
            if(statusLabel) statusLabel.innerText = "Sincronizado: " + new Date().toLocaleTimeString();

        } catch (e) {
            console.error("Erro no Upload", e);
            if(!isSilent) UI.showToast("Falha ao subir para nuvem", "danger");
        }
    }
};

// ==========================================
// 4. UI, THEME, GAMIFICATION & BACKUP LOCAL
// ==========================================
const UI = {
    periodoGraficoDias: 30,

    initTheme() {
        const theme = DB.get('sf_theme', 'light');
        document.body.setAttribute('data-theme', theme);
        this.updateThemeIcon(theme);

        document.getElementById('btn-theme-toggle')?.addEventListener('click', () => this.toggleTheme());
        document.getElementById('btn-theme-toggle-float')?.addEventListener('click', () => this.toggleTheme());
    },

    toggleTheme() {
        const currentTheme = document.body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', newTheme);
        DB.set('sf_theme', newTheme);
        this.updateThemeIcon(newTheme);
        App.updateAll();
    },

    updateThemeIcon(theme) {
        const iconHTML = theme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
        const iconColor = theme === 'dark' ? '#f59e0b' : '#64748b';
        
        ['btn-theme-toggle', 'btn-theme-toggle-float'].forEach(id => {
            const btn = document.getElementById(id);
            if(btn) {
                btn.innerHTML = iconHTML;
                btn.style.color = iconColor;
            }
        });
    },

    ativarAba(targetId, salvar = true) {
        const abaDestino = document.getElementById(targetId);
        if (!abaDestino) return;

        document.querySelectorAll('.nav-btn').forEach(btn => 
            btn.classList.toggle('active', btn.getAttribute('data-target') === targetId)
        );
        document.querySelectorAll('.tab-content').forEach(content => 
            content.classList.remove('active')
        );
        
        abaDestino.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (salvar) localStorage.setItem('sf_aba_ativa', targetId);
    },

    initNavegacao() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if(btn.id !== 'btn-theme-toggle' && btn.id !== 'btn-theme-toggle-float') {
                btn.addEventListener('click', () => this.ativarAba(btn.getAttribute('data-target')));
            }
        });

        document.querySelectorAll('.dashboard-link').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.ativarAba(btn.getAttribute('data-target'));
            });
        });

        document.querySelectorAll('.chart-card[data-target]').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.chart-filters')) return;
                if (e.target.tagName === 'CANVAS' && e.target.id === 'donutChart') return;
                this.ativarAba(card.getAttribute('data-target'));
            });
        });

        const abaSalva = localStorage.getItem('sf_aba_ativa');
        if (abaSalva) this.ativarAba(abaSalva, false);

        document.getElementById('fab-add-tx')?.addEventListener('click', () => {
            this.ativarAba('descritivos');
            document.getElementById('input-desc').focus();
        });
    },

    showToast(msg, tipo = 'success') {
        const icons = { success: 'fa-check', warning: 'fa-triangle-exclamation', danger: 'fa-circle-xmark' };
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${tipo}`;
        toast.innerHTML = `<i class="fa-solid ${icons[tipo]}"></i> <span>${msg}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOutRight 0.4s forwards';
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    },

    checkGamification(patrimonioTotal) {
        const milestones = [10000, 25000, 50000, 75000, 100000];
        let reached = DB.get('sf_milestones', []);
        
        for (let m of milestones) {
            if (patrimonioTotal >= m && !reached.includes(m)) {
                reached.push(m);
                DB.set('sf_milestones', reached);
                this.showToast(`Parabéns! Você alcançou o marco de R$ ${m/1000}k!`, 'success');
                break;
            }
        }
    }
};

const Backup = {
    init() {
        document.getElementById('btn-export')?.addEventListener('click', () => this.exportar());
        
        document.getElementById('btn-import-trigger')?.addEventListener('click', () => {
            document.getElementById('input-import').click();
        });
        
        document.getElementById('input-import')?.addEventListener('change', (e) => this.importar(e));
    },

    exportar() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('sf_')) {
                data[key] = localStorage.getItem(key);
            }
        }
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dataStr = new Date().toISOString().split('T')[0];
        a.download = `backup_financas_${dataStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        UI.showToast("Backup exportado com sucesso!", "success");
    },

    importar(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                let imported = 0;
                
                // Limpa as chaves antigas do sistema para evitar lixo do cache
                const chavesParaRemover = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key.startsWith('sf_') && key !== 'sf_google_token') { 
                        chavesParaRemover.push(key);
                    }
                }
                chavesParaRemover.forEach(k => localStorage.removeItem(k));

                // Aplica os dados importados
                for (const key in data) {
                    if (key.startsWith('sf_')) {
                        localStorage.setItem(key, data[key]);
                        imported++;
                    }
                }
                
                if (imported > 0) {
                    UI.showToast("Dados aplicados! Redesenhando...", "success");
                    App.updateAll();
                    Cloud.triggerAutoSave();
                    document.getElementById('input-import').value = ''; 
                } else {
                    UI.showToast("Arquivo de backup inválido ou vazio.", "warning");
                }
            } catch (error) {
                console.error("Erro na importação:", error);
                UI.showToast("Erro ao ler o arquivo JSON.", "danger");
            }
        };
        reader.readAsText(file);
    }
};

// ==========================================
// 5. DASHBOARD E GRÁFICOS
// ==========================================
const Dashboard = {
    lineChart: null,
    donutChart: null,
    periodoFechamento: 'mes',

    init() {
        document.getElementById('btn-edit-cc')?.addEventListener('click', () => {
            const novoCC = prompt("Atualizar Saldo da Conta Corrente (R$):", DB.getCC().toFixed(2));
            if(novoCC !== null && !isNaN(parseFloat(novoCC.replace(',', '.')))) {
                DB.setCC(parseFloat(novoCC.replace(',', '.'))); 
                App.updateAll();
            }
        });

        document.querySelectorAll('#chart-period .btn-period').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#chart-period .btn-period').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                UI.periodoGraficoDias = parseInt(e.target.getAttribute('data-days'));
                this.render();
            });
        });

        document.querySelectorAll('#summary-period .btn-period').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#summary-period .btn-period').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.periodoFechamento = e.target.getAttribute('data-period');
                this.calcularFechamento();
            });
        });
    },

    calcularFechamento() {
        const transacoes = DB.getTransacoes();
        const bancos = DB.getBancos();
        
        const dataH = new Date();
        const year = dataH.getFullYear();
        const month = String(dataH.getMonth() + 1).padStart(2, '0');
        const day = String(dataH.getDate()).padStart(2, '0');
        
        const mesStrTx = `${year}-${month}`;
        const diaStrTx = `${year}-${month}-${day}`;
        
        const mesStrBk = `${month}/${year}`;
        const diaStrBk = `${day}/${month}/${year}`;
        
        let rec = 0; let desp = 0; let ap = 0; let rend = 0;

        transacoes.forEach(t => {
            const match = (this.periodoFechamento === 'dia') ? (t.data === diaStrTx) : t.data.startsWith(mesStrTx);
            if(match) {
                if(t.cat.includes('Aporte')) ap += t.valor;
                else if(t.tipo === 'entrada') rec += t.valor;
                else if(t.tipo === 'saida') desp += t.valor;
            }
        });

        Object.values(bancos).forEach(banco => {
            banco.historico.forEach(h => {
                if (h.tipo === 'rendimento') {
                    let hDataPad = h.data.split('/').map(p => p.padStart(2, '0')).join('/');
                    const matchBk = (this.periodoFechamento === 'dia') ? (hDataPad === diaStrBk) : hDataPad.endsWith(mesStrBk);
                    if (matchBk) rend += h.valorMovimento;
                }
            });
        });

        const balanco = (rec + rend + ap) - desp;
        
        document.getElementById('mes-receitas').innerText = rec.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        const elRend = document.getElementById('mes-rendimentos');
        if (elRend) elRend.innerText = rend.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        document.getElementById('mes-despesas').innerText = desp.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        document.getElementById('mes-aportes').innerText = ap.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        
        document.getElementById('mes-balanco').innerText = balanco.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        document.getElementById('mes-balanco').style.color = balanco >= 0 ? 'var(--success)' : 'var(--danger)';
    },

    calcularProjecao(patrimonioTotal) {
        if (patrimonioTotal >= 100000) {
            document.getElementById('meta-projecao').innerHTML = `<i class="fa-solid fa-trophy"></i> Meta alcançada! Parabéns!`;
            return;
        }

        const dataH = new Date();
        const past90Days = new Date();
        past90Days.setDate(dataH.getDate() - 90);
        
        const isoPast90 = past90Days.toISOString().split('T')[0];
        
        let ganhos90Dias = 0;

        DB.getTransacoes().forEach(t => {
            if (t.cat.includes('Aporte') && t.data >= isoPast90) {
                ganhos90Dias += t.valor;
            }
        });

        Object.values(DB.getBancos()).forEach(banco => {
            banco.historico.forEach(h => {
                if (h.tipo === 'rendimento') {
                    const parts = h.data.split('/');
                    if (parts.length === 3) {
                        const hDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                        if (hDate >= past90Days) ganhos90Dias += h.valorMovimento;
                    }
                }
            });
        });

        const mediaMensal = ganhos90Dias / 3;
        
        if (mediaMensal <= 0) {
            document.getElementById('meta-projecao').innerHTML = `<i class="fa-solid fa-chart-line"></i> Faça aportes para calcular a projeção.`;
            return;
        }

        const faltam = 100000 - patrimonioTotal;
        const mesesFaltantes = Math.ceil(faltam / mediaMensal);
        
        const dataProjetada = new Date();
        dataProjetada.setMonth(dataProjetada.getMonth() + mesesFaltantes);
        
        const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const strProj = `${mesesNomes[dataProjetada.getMonth()]}/${dataProjetada.getFullYear()}`;

        document.getElementById('meta-projecao').innerHTML = `<i class="fa-solid fa-rocket"></i> Projeção 100k: <b>${strProj}</b> (Média: R$ ${Math.round(mediaMensal)})`;
    },

    render() {
        const cc = DB.getCC();
        document.getElementById('valor-conta-corrente').innerText = cc.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        
        let totBancos = Object.values(DB.getBancos()).reduce((acc, b) => acc + b.saldo, 0);
        let totEmp = DB.getEmprestimos().reduce((acc, emp) => acc + (emp.totalReceber - (emp.parcelas.filter(p => p.paga).length * emp.valorParcela)), 0);
        let totRV = DB.getAtivos().reduce((acc, a) => acc + (a.quantidade * a.precoAtual), 0);
        const patrimonio = cc + totBancos + totEmp + totRV;

        document.getElementById('patrimonio-valor').innerText = patrimonio.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        document.getElementById('dash-cc').innerText = cc.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        document.getElementById('dash-caixinhas').innerText = totBancos.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        document.getElementById('dash-receber').innerText = totEmp.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
        document.getElementById('dash-rv').innerText = totRV.toLocaleString('pt-BR', {style:'currency',currency:'BRL'});

        const perc = Math.min((patrimonio / 100000) * 100, 100);
        document.getElementById('meta-fill').style.width = `${perc.toFixed(1)}%`;
        document.getElementById('meta-texto').innerText = `${perc.toFixed(1)}% concluído | Faltam ${Math.max(0, 100000 - patrimonio).toLocaleString('pt-BR', {style:'currency',currency:'BRL'})}`;

        UI.checkGamification(patrimonio);
        this.calcularProjecao(patrimonio);
        this.calcularFechamento();

        let hist = DB.getHistoricoPatrimonio();
        const hoje = new Date().toISOString().split('T')[0];
        if (hist.length === 0 && patrimonio > 0) {
            for (let i = 6; i >= 0; i--) {
                const d = new Date(); d.setDate(d.getDate() - i);
                hist.push({ data: d.toISOString().split('T')[0], valor: patrimonio * (1 - (i*0.01)) });
            }
        }
        const idx = hist.findIndex(h => h.data === hoje);
        if (idx !== -1) hist[idx].valor = patrimonio; else hist.push({ data: hoje, valor: patrimonio });
        if (hist.length > 365) hist.shift();
        DB.setHistoricoPatrimonio(hist);

        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        const histFiltrado = hist.slice(-UI.periodoGraficoDias);
        if(this.lineChart) this.lineChart.destroy();
        this.lineChart = new Chart(document.getElementById('lineChart'), {
            type: 'line',
            data: { labels: histFiltrado.map(h => h.data.split('-').reverse().slice(0,2).join('/')), datasets: [{ label: 'Patrimônio', data: histFiltrado.map(h => h.valor), borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 3, tension: 0.4, fill: true }] },
            options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: {color: textColor} }, y: { grid: {color: gridColor}, ticks:{color:textColor} } } }
        });

        if(this.donutChart) this.donutChart.destroy();
        this.donutChart = new Chart(document.getElementById('donutChart'), {
            type: 'doughnut',
            data: { 
                labels: ['C. Corrente', 'Caixinhas', 'A Receber', 'Renda Variável'], 
                datasets: [{ data: [cc, totBancos, totEmp, totRV], backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'], borderWidth: 0 }] 
            },
            options: { 
                plugins: { legend: { position: 'bottom', labels: {color: textColor} } },
                onClick: (e, elements) => {
                    if (elements && elements.length > 0) {
                        const index = elements[0].index;
                        const destinos = ['dashboard', 'rendimentos', 'emprestimos', 'renda-variavel'];
                        UI.ativarAba(destinos[index]);
                    } else {
                        UI.ativarAba('renda-variavel');
                    }
                }
            }
        });
    }
};

// ==========================================
// 6. TRANSAÇÕES E FILTROS
// ==========================================
const Transacoes = {
    idEmEdicao: null,
    sortCol: 'data',
    sortAsc: false,

    init() {
        document.getElementById('input-cat')?.addEventListener('change', (e) => {
            document.getElementById('input-tipo').classList.toggle('hidden', e.target.value !== 'Outros');
        });
        document.getElementById('btn-adicionar')?.addEventListener('click', () => this.salvar());
        
        ['filter-busca', 'filter-categoria', 'filter-tipo', 'filter-data'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => this.render());
        });
        
        document.getElementById('btn-toggle-filters')?.addEventListener('click', function() {
            const fb = document.getElementById('filters-bar-container');
            fb.classList.toggle('hidden');
            if (fb.classList.contains('hidden')) {
                this.innerHTML = '<i class="fa-solid fa-filter"></i> Mostrar Filtros e Busca';
            } else {
                this.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Ocultar Filtros';
            }
        });

        document.querySelectorAll('.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.getAttribute('data-sort');
                if (this.sortCol === col) {
                    this.sortAsc = !this.sortAsc;
                } else {
                    this.sortCol = col;
                    this.sortAsc = true;
                }
                
                document.querySelectorAll('.sortable i').forEach(i => i.className = 'fa-solid fa-sort');
                th.querySelector('i').className = this.sortAsc ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
                
                this.render();
            });
        });

        document.getElementById('table-finance')?.addEventListener('click', (e) => {
            const btnDel = e.target.closest('.btn-delete');
            const btnEdit = e.target.closest('.btn-edit');
            if(btnDel) this.apagar(parseInt(btnDel.dataset.id));
            if(btnEdit) this.editar(parseInt(btnEdit.dataset.id));
        });
    },

    aplicarEfeito(t, reverter = false) {
        const mult = reverter ? -1 : 1;
        let cc = DB.getCC();
        let bancos = DB.getBancos();

        if (t.tipo === 'saida') {
            cc -= (t.valor * mult);
        } else if (t.tipo === 'entrada' && t.cat === 'Outros') {
            cc += (t.valor * mult);
        } else if (t.tipo === 'entrada' && t.bancoDestino) {
            const b = t.bancoDestino;
            if (reverter) {
                bancos[b].saldo -= t.valor;
                const idx = bancos[b].historico.findIndex(h => h.tipo === 'aporte' && h.valorMovimento === t.valor);
                if (idx !== -1) bancos[b].historico.splice(idx, 1);
            } else {
                bancos[b].saldo += t.valor;
                bancos[b].historico.unshift({ data: new Date().toLocaleDateString('pt-BR'), valorAnterior: bancos[b].saldo - t.valor, valorMovimento: t.valor, valorNovo: bancos[b].saldo, tipo: 'aporte' });
            }
            DB.setBancos(bancos);
        }
        DB.setCC(cc);
    },

    salvar() {
        const data = document.getElementById('input-data').value;
        const desc = document.getElementById('input-desc').value;
        const cat = document.getElementById('input-cat').value;
        const val = parseFloat(document.getElementById('input-valor').value);

        if (!data || !desc || !cat || isNaN(val)) return UI.showToast("Preencha todos os campos corretamente.", "warning");
        
        let tipo = cat.includes('Aporte') ? 'entrada' : (cat === 'Outros' ? document.getElementById('input-tipo').value : 'saida');
        let novaT = { id: this.idEmEdicao || Date.now(), data, desc, cat, valor: val, tipo };
        let trans = DB.getTransacoes();

        if (this.idEmEdicao) {
            const idx = trans.findIndex(x => x.id === this.idEmEdicao);
            this.aplicarEfeito(trans[idx], true);
            if(novaT.tipo === 'entrada' && novaT.cat.includes('Aporte')) novaT.bancoDestino = trans[idx].bancoDestino;
            trans[idx] = novaT;
            this.idEmEdicao = null;
            document.getElementById('btn-adicionar').innerHTML = '<i class="fa-solid fa-plus"></i> Adicionar';
            UI.showToast("Transação atualizada.");
        } else {
            if (tipo === 'entrada' && cat.includes('Aporte')) {
                const bks = DB.getBancos();
                novaT.bancoDestino = Object.keys(bks).reduce((a, b) => bks[a].saldo < bks[b].saldo ? a : b);
            }
            trans.unshift(novaT);
            UI.showToast("Transação salva.");
        }

        this.aplicarEfeito(novaT);
        DB.setTransacoes(trans);
        ['input-data','input-desc','input-valor','input-cat'].forEach(id => document.getElementById(id).value = '');
        App.updateAll();
    },

    apagar(id) {
        if(!confirm("Apagar transação?")) return;
        let trans = DB.getTransacoes();
        const idx = trans.findIndex(t => t.id === id);
        if(idx !== -1) {
            const t = trans[idx];
            this.aplicarEfeito(t, true);
            
            if (t.empId && t.parcelaIdx !== undefined) {
                let emps = DB.getEmprestimos();
                let emp = emps.find(e => e.id === t.empId);
                if (emp && emp.parcelas[t.parcelaIdx]) {
                    emp.parcelas[t.parcelaIdx].paga = false;
                    DB.setEmprestimos(emps);
                }
            }

            trans.splice(idx, 1);
            DB.setTransacoes(trans);
            UI.showToast("Transação removida.", "danger");
            App.updateAll();
        }
    },

    editar(id) {
        const t = DB.getTransacoes().find(x => x.id === id);
        if(t) {
            this.idEmEdicao = t.id;
            document.getElementById('input-data').type = 'date'; 
            document.getElementById('input-data').value = t.data;
            document.getElementById('input-desc').value = t.desc;
            document.getElementById('input-valor').value = t.valor;
            document.getElementById('input-cat').value = t.cat;
            if(t.cat === 'Outros') {
                document.getElementById('input-tipo').classList.remove('hidden');
                document.getElementById('input-tipo').value = t.tipo;
            }
            document.getElementById('btn-adicionar').innerHTML = '<i class="fa-solid fa-check"></i> Salvar Edição';
            window.scrollTo({ top: document.querySelector('.financial-form').offsetTop - 50, behavior: 'smooth' });
        }
    },

    render() {
        const tbody = document.querySelector('#table-finance tbody');
        if(!tbody) return;

        const termo = document.getElementById('filter-busca').value.toLowerCase();
        const catF = document.getElementById('filter-categoria').value;
        const tipoF = document.getElementById('filter-tipo').value;
        const dataF = document.getElementById('filter-data').value;

        let filtradas = DB.getTransacoes().filter(t => {
            return (t.desc.toLowerCase().includes(termo) || t.valor.toString().includes(termo)) &&
                   (catF === 'todas' || t.cat === catF) &&
                   (tipoF === 'todos' || t.tipo === tipoF) &&
                   (!dataF || t.data === dataF);
        });

        filtradas.sort((a, b) => {
            let valA = a[this.sortCol];
            let valB = b[this.sortCol];

            if (this.sortCol === 'desc' || this.sortCol === 'cat') {
                valA = valA.toLowerCase(); valB = valB.toLowerCase();
            }

            if (valA < valB) return this.sortAsc ? -1 : 1;
            if (valA > valB) return this.sortAsc ? 1 : -1;
            return 0;
        });

        tbody.innerHTML = filtradas.length ? filtradas.map(t => `
            <tr>
                <td>${t.data.split('-').reverse().join('/')}</td>
                <td>${t.desc}</td>
                <td><span style="background: rgba(148, 163, 184, 0.1); padding: 4px 10px; border-radius: 6px; font-size: 11px;">${t.cat}</span></td>
                <td class="${t.tipo === 'entrada' ? 'positive' : 'negative'}">${t.tipo === 'entrada' ? '' : '- '}${t.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                <td class="actions">
                    <button class="btn-action btn-edit" data-id="${t.id}"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-action btn-delete" data-id="${t.id}"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state"><p>Nenhuma transação.</p></td></tr>`;
    }
};

// ==========================================
// 7. CAIXINHAS E RENDA VARIÁVEL
// ==========================================
const Caixinhas = {
    init() {
        document.getElementById('bancos-container')?.addEventListener('click', (e) => {
            const card = e.target.closest('.rendimento-card');
            
            if(card && e.target.closest('.expand-action') && !e.target.closest('.no-expand')) {
                document.querySelectorAll('.rendimento-card').forEach(c => { if(c !== card) c.classList.remove('expanded'); });
                card.classList.toggle('expanded');
            }

            const btnAction = e.target.closest('.btn-action-small');
            if(btnAction) {
                const banco = btnAction.dataset.banco;
                this.esconderInputs(banco);
                document.getElementById(`saldo-${banco}`).classList.add('hidden');
                document.getElementById(`actions-${banco}`).classList.add('hidden');

                if(btnAction.classList.contains('btn-edit-saldo')) {
                    document.getElementById(`edit-box-${banco}`).classList.remove('hidden');
                    document.querySelector(`.btn-save-saldo[data-banco="${banco}"]`).classList.remove('hidden');
                    document.getElementById(`input-saldo-${banco}`).value = DB.getBancos()[banco].saldo.toFixed(2);
                } else if(btnAction.classList.contains('btn-add-yield')) {
                    document.getElementById(`yield-box-${banco}`).classList.remove('hidden');
                    document.querySelector(`.btn-save-yield[data-banco="${banco}"]`).classList.remove('hidden');
                } else if(btnAction.classList.contains('btn-withdraw')) {
                    document.getElementById(`withdraw-box-${banco}`).classList.remove('hidden');
                    document.querySelector(`.btn-save-withdraw[data-banco="${banco}"]`).classList.remove('hidden');
                }
            }

            const btnSave = e.target.closest('button[class^="btn-save"]');
            if(btnSave) {
                const banco = btnSave.dataset.banco;
                let bancos = DB.getBancos();

                if(btnSave.classList.contains('btn-save-saldo')) {
                    const val = parseFloat(document.getElementById(`input-saldo-${banco}`).value);
                    if(!isNaN(val)) bancos[banco].saldo = val;
                } else if(btnSave.classList.contains('btn-save-yield')) {
                    const val = parseFloat(document.getElementById(`input-yield-${banco}`).value);
                    if(!isNaN(val) && val > 0) {
                        const ant = bancos[banco].saldo;
                        bancos[banco].saldo += val;
                        bancos[banco].historico.unshift({ data: new Date().toLocaleDateString('pt-BR'), valorAnterior: ant, valorMovimento: val, valorNovo: bancos[banco].saldo, tipo: 'rendimento' });
                    }
                } else if(btnSave.classList.contains('btn-save-withdraw')) {
                    const val = parseFloat(document.getElementById(`input-withdraw-${banco}`).value);
                    if(!isNaN(val) && val > 0) {
                        const ant = bancos[banco].saldo;
                        bancos[banco].saldo = Math.max(0, ant - val);
                        bancos[banco].historico.unshift({ data: new Date().toLocaleDateString('pt-BR'), valorAnterior: ant, valorMovimento: val, valorNovo: bancos[banco].saldo, tipo: 'retirada' });
                        DB.setCC(DB.getCC() + val);
                    }
                }
                DB.setBancos(bancos);
                this.esconderInputs(banco);
                App.updateAll();
            }
        });

        window.removerHistoricoBanco = (banco, idx) => {
            if(!confirm("Remover o registro do histórico?")) return;
            let bancos = DB.getBancos();
            const reg = bancos[banco].historico[idx];
            
            if (reg.tipo === 'rendimento' || reg.tipo === 'aporte') bancos[banco].saldo = Math.max(0, bancos[banco].saldo - reg.valorMovimento);
            else if (reg.tipo === 'retirada') bancos[banco].saldo += reg.valorMovimento;
            
            bancos[banco].historico.splice(idx, 1);
            DB.setBancos(bancos);
            App.updateAll();
        };
    },

    esconderInputs(banco) {
        document.getElementById(`edit-box-${banco}`).classList.add('hidden');
        document.getElementById(`yield-box-${banco}`).classList.add('hidden');
        document.getElementById(`withdraw-box-${banco}`).classList.add('hidden');
        document.querySelector(`.btn-save-saldo[data-banco="${banco}"]`).classList.add('hidden');
        document.querySelector(`.btn-save-yield[data-banco="${banco}"]`).classList.add('hidden');
        document.querySelector(`.btn-save-withdraw[data-banco="${banco}"]`).classList.add('hidden');
        
        document.getElementById(`saldo-${banco}`).classList.remove('hidden');
        document.getElementById(`actions-${banco}`).classList.remove('hidden');
        
        document.getElementById(`input-saldo-${banco}`).value = '';
        document.getElementById(`input-yield-${banco}`).value = '';
        document.getElementById(`input-withdraw-${banco}`).value = '';
    },

    render() {
        const bancos = DB.getBancos();
        const hojeBr = new Date().toLocaleDateString('pt-BR');
        let totalRendimentoHoje = 0;

        ['nubank', 'mp', 'picpay'].forEach(banco => {
            const conta = bancos[banco];
            
            const rendimentos = conta.historico.filter(h => h.tipo === 'rendimento').map(h => h.valorMovimento);
            const media = rendimentos.length ? rendimentos.reduce((a,b)=>a+b, 0) / rendimentos.length : 0;

            conta.historico.forEach(h => {
                if (h.tipo === 'rendimento' && h.data === hojeBr) {
                    totalRendimentoHoje += h.valorMovimento;
                }
            });

            document.getElementById(`saldo-${banco}`).innerText = conta.saldo.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
            document.getElementById(`diario-${banco}`).innerText = media.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

            const histContainer = document.getElementById(`historico-${banco}`);
            histContainer.innerHTML = conta.historico.length ? conta.historico.map((h, i) => {
                const isYield = h.tipo === 'rendimento' || h.tipo === 'aporte';
                const tagClass = h.tipo === 'aporte' ? 'hist-tag-aporte' : (isYield ? 'hist-tag-yield' : 'hist-tag-retirada');
                return `
                <div class="hist-item">
                    <div class="hist-details">
                        <span class="hist-date">${h.data} <span class="hist-tag ${tagClass}">${h.tipo}</span></span>
                        <span class="hist-calc">${h.valorAnterior.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} ➔ ${h.valorNovo.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span>
                    </div>
                    <span style="display: flex; align-items: center;">
                        <span class="${isYield ? 'hist-yield' : 'hist-withdraw'}">${isYield ? '+' : '-'} ${h.valorMovimento.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span>
                        <button class="btn-action btn-delete" onclick="removerHistoricoBanco('${banco}', ${i})" style="margin-left: 8px;"><i class="fa-solid fa-trash"></i></button>
                    </span>
                </div>`;
            }).join('') : '<p style="text-align:center; color:var(--text-placeholder); font-size: 11px;">Nenhum registro.</p>';
        });

        const badgeHoje = document.getElementById('total-rendimento-dia');
        if (badgeHoje) {
            badgeHoje.innerText = '+ ' + totalRendimentoHoje.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }
    }
};

const RV = {
    init() {
        document.getElementById('btn-add-rv')?.addEventListener('click', () => {
            const ticker = document.getElementById('rv-ticker').value;
            const tipo = document.getElementById('rv-tipo').value;
            const qtde = parseFloat(document.getElementById('rv-qtde').value);
            const preco = parseFloat(document.getElementById('rv-preco').value);

            if(!ticker || !tipo || isNaN(qtde) || isNaN(preco)) return UI.showToast("Dados do ativo inválidos.", "warning");
            
            let ativos = DB.getAtivos();
            ativos.unshift({ id: Date.now(), ticker, tipo, quantidade: qtde, precoMedio: preco, precoAtual: preco });
            DB.setAtivos(ativos);
            UI.showToast("Ativo adicionado!");
            
            ['rv-ticker','rv-tipo','rv-qtde','rv-preco'].forEach(id => document.getElementById(id).value = '');
            App.updateAll();
        });

        window.apagarAtivo = (id) => {
            if(confirm("Apagar ativo?")) { DB.setAtivos(DB.getAtivos().filter(a => a.id !== id)); App.updateAll(); }
        };
        window.atualizarPrecoAtivo = (id) => {
            const ativos = DB.getAtivos();
            const ativo = ativos.find(a => a.id === id);
            const val = parseFloat(document.getElementById(`patual-${id}`).value);
            if(ativo && !isNaN(val)) { ativo.precoAtual = val; DB.setAtivos(ativos); App.updateAll(); UI.showToast("Cotação atualizada."); }
        };
        window.receberDividendo = (id) => {
            const ativo = DB.getAtivos().find(a => a.id === id);
            const val = parseFloat(prompt(`Valor do dividendo de ${ativo.ticker.toUpperCase()} (R$):`));
            if(!isNaN(val) && val > 0) {
                DB.setCC(DB.getCC() + val);
                let t = DB.getTransacoes();
                t.unshift({ id: Date.now(), data: new Date().toISOString().split('T')[0], desc: `Dividendo - ${ativo.ticker}`, cat: 'Outros', valor: val, tipo: 'entrada' });
                DB.setTransacoes(t);
                App.updateAll();
                UI.showToast("Provento adicionado à C.C.");
            }
        }
    },
    render() {
        const c = document.getElementById('lista-ativos');
        if(!c) return;
        const ativos = DB.getAtivos();
        c.innerHTML = ativos.length ? ativos.map(a => {
            const tInv = a.quantidade * a.precoMedio;
            const tAtu = a.quantidade * a.precoAtual;
            const varP = tInv > 0 ? ((tAtu - tInv)/tInv)*100 : 0;
            return `
            <div class="card rv-card">
                <div class="rv-header">
                    <div class="rv-ticker"><b>${a.ticker.toUpperCase()}</b></div>
                    <div class="rv-type-badge badge-${a.tipo.toLowerCase()}">${a.tipo}</div>
                </div>
                <div class="rv-body">
                    <div class="rv-row"><span class="rv-label">Investido</span><span class="rv-value">${tInv.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span></div>
                    <div class="rv-row"><span class="rv-label">Posição Atual</span><span class="${varP >= 0 ? 'rv-profit' : 'rv-loss'}">${tAtu.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} (${varP.toFixed(2)}%)</span></div>
                    <div class="rv-row" style="margin-top: 10px;">
                        <input type="number" step="0.01" class="rv-input-price" id="patual-${a.id}" value="${a.precoAtual.toFixed(2)}">
                        <button class="btn-update-price" onclick="atualizarPrecoAtivo(${a.id})"><i class="fa-solid fa-rotate-right"></i></button>
                    </div>
                </div>
                <div class="rv-footer">
                    <button class="btn-action btn-delete" onclick="apagarAtivo(${a.id})"><i class="fa-solid fa-trash"></i></button>
                    <button class="btn-dividend" onclick="receberDividendo(${a.id})"><i class="fa-solid fa-hand-holding-dollar"></i> Provento</button>
                </div>
            </div>`;
        }).join('') : `<div class="empty-state"><p>Nenhum ativo.</p></div>`;
    }
};

const Emprestimos = {
    init() {
        document.getElementById('btn-add-emp')?.addEventListener('click', () => {
            const val = parseFloat(document.getElementById('emp-valor').value);
            const prazo = parseInt(document.getElementById('emp-prazo').value);
            const juros = parseFloat(document.getElementById('emp-taxa-total').value);
            const nome = document.getElementById('emp-nome').value;
            const int = document.getElementById('emp-intervalo').value;

            if(!nome || isNaN(val) || isNaN(prazo)) return UI.showToast("Dados inválidos", "warning");

            const totR = val + (val*(juros/100));
            
            let e = DB.getEmprestimos();
            const novoEmpId = Date.now();
            e.unshift({ id: novoEmpId, nome, valorEmprestado: val, jurosTotalPorcentagem: juros, totalReceber: totR, valorParcela: totR/prazo, intervalo: int, prazo, parcelas: Array.from({length: prazo}, ()=>({paga: false})) });
            DB.setEmprestimos(e);
            
            const dataH = new Date();
            const dataLocal = dataH.getFullYear() + '-' + String(dataH.getMonth() + 1).padStart(2, '0') + '-' + String(dataH.getDate()).padStart(2, '0');
            
            let trans = DB.getTransacoes();
            const novaT = {
                id: Date.now() + 1,
                data: dataLocal,
                desc: `Empréstimo Concedido: ${nome}`,
                cat: 'Outros',
                valor: val,
                tipo: 'saida'
            };
            Transacoes.aplicarEfeito(novaT); 
            trans.unshift(novaT);
            DB.setTransacoes(trans);

            UI.showToast("Empréstimo criado e registrado no Descritivo!");
            ['emp-nome','emp-valor','emp-taxa-total','emp-prazo','emp-intervalo'].forEach(id => document.getElementById(id).value = '');
            App.updateAll();
        });

        document.getElementById('lista-emprestimos')?.addEventListener('click', (e) => {
            if(e.target.classList.contains('parcela-check')) {
                let emps = DB.getEmprestimos();
                const empId = parseInt(e.target.dataset.emp);
                const pIdx = parseInt(e.target.dataset.idx);
                const emp = emps.find(x => x.id === empId);
                const isChecked = e.target.checked;

                emp.parcelas[pIdx].paga = isChecked;
                DB.setEmprestimos(emps);
                
                let trans = DB.getTransacoes();

                if (isChecked) {
                    const dataH = new Date();
                    const dataLocal = dataH.getFullYear() + '-' + String(dataH.getMonth() + 1).padStart(2, '0') + '-' + String(dataH.getDate()).padStart(2, '0');
                    
                    const novaT = {
                        id: Date.now(),
                        data: dataLocal,
                        desc: `Recebimento: ${emp.nome} (Parc. ${pIdx + 1})`,
                        cat: 'Outros',
                        valor: emp.valorParcela,
                        tipo: 'entrada',
                        empId: empId,
                        parcelaIdx: pIdx
                    };
                    Transacoes.aplicarEfeito(novaT); 
                    trans.unshift(novaT);
                    UI.showToast("Parcela recebida e salva no Descritivo!");
                } else {
                    const tIndex = trans.findIndex(t => t.empId === empId && t.parcelaIdx === pIdx);
                    if (tIndex !== -1) {
                        Transacoes.aplicarEfeito(trans[tIndex], true);
                        trans.splice(tIndex, 1);
                    } else {
                        DB.setCC(DB.getCC() - emp.valorParcela);
                    }
                    UI.showToast("Recebimento cancelado.");
                }

                DB.setTransacoes(trans);
                App.updateAll();
            }
            
            const btnDel = e.target.closest('.btn-delete-emp');
            if(btnDel && confirm("Apagar empréstimo permanentemente? (As transações já gravadas no Descritivo NÃO serão apagadas automaticamente)")) {
                DB.setEmprestimos(DB.getEmprestimos().filter(emp => emp.id !== parseInt(btnDel.dataset.id)));
                App.updateAll();
            }
        });
    },
    render() {
        const c = document.getElementById('lista-emprestimos');
        if(!c) return;
        const emps = DB.getEmprestimos();
        c.innerHTML = emps.length ? emps.map(emp => {
            const pagas = emp.parcelas.filter(p => p.paga).length;
            return `
            <div class="emp-card">
                <div class="emp-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <div class="emp-title"><h3>${emp.nome}</h3><p>R$ ${emp.valorEmprestado} + ${emp.jurosTotalPorcentagem}%</p></div>
                    <div class="emp-stats"><div class="total">${emp.totalReceber.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div></div>
                </div>
                <div class="emp-progress-container">
                    <div class="emp-progress-bar"><div class="emp-progress-fill" style="width: ${(pagas/emp.prazo)*100}%;"></div></div>
                </div>
                <div class="emp-body">
                    <div class="emp-body-header"><h4>Controle</h4><button class="btn-delete-emp" data-id="${emp.id}"><i class="fa-solid fa-trash"></i> Apagar</button></div>
                    <div class="parcelas-list">
                        ${emp.parcelas.map((p, i) => `
                            <label class="parcela-item ${p.paga ? 'paga' : ''}">
                                <div class="checkbox-container">
                                    <input type="checkbox" class="parcela-check" data-emp="${emp.id}" data-idx="${i}" ${p.paga ? 'checked' : ''}>
                                    <span>Parc. ${i + 1}</span>
                                </div>
                                <span class="valor-parcela">${emp.valorParcela.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            </div>`;
        }).join('') : `<div class="empty-state"><p>Sem empréstimos ativos.</p></div>`;
    }
};

// ==========================================
// 8. ORQUESTRADOR CENTRAL (APP)
// ==========================================
const App = {
    init() {
        UI.initTheme();
        UI.initNavegacao();
        Cloud.init(); 
        Backup.init();
        Transacoes.init();
        Dashboard.init();
        Caixinhas.init();
        RV.init();
        Emprestimos.init();
        this.updateAll();
    },
    updateAll() {
        Caixinhas.render();
        Transacoes.render();
        RV.render();
        Emprestimos.render();
        Dashboard.render();
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
