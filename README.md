# Gisela — controle de jogadores e mensalidades

HTML/CSS/JS estático (sem framework, sem build) + Supabase.

## Configuração

1. **Banco:** no Supabase, abra *SQL Editor* e rode, nesta ordem:
   1. `supabase/migrations/001_etapa1.sql`
   2. `supabase/migrations/002_etapa2.sql`

   Os dois arquivos são idempotentes (podem ser rodados de novo sem efeito colateral).
2. **Auth:** em *Authentication → Providers → Email*, desative "Allow new users to sign up" e
   crie os usuários organizadores em *Authentication → Users → Add user*.
3. **Chaves:** preencha `js/config.js` com a Project URL e a anon key (*Project Settings → API*).
4. **Valor padrão:** depois de entrar, abra Configurações (engrenagem) e defina a mensalidade padrão.

## Rodar localmente

Os scripts são ES modules, então o app precisa ser servido por HTTP (abrir o arquivo direto
com `file://` não funciona). Qualquer servidor estático serve, por exemplo:

```sh
npx serve .
```

ou a extensão *Live Server* do VS Code.

## Testes

Precisa só do Node 20+ (sem dependências):

```sh
npm test          # ou: node --test
```

Cobrem o parser de importação (`tests/import.test.js`) e a exportação CSV com ida e volta
(`tests/export.test.js`).

## PWA e atualização

- `manifest.webmanifest` + ícones em `icons/`. Os PNGs são gerados a partir dos SVGs com
  `node scripts/gerar-icones.mjs` (usa o Chrome ou o Edge instalado).
- `sw.js` é *network-first*: online, sempre busca HTML/JS/CSS novos; o cache só é usado offline.
  Chamadas ao Supabase e a outros domínios nunca passam pelo cache.
- O service worker só é registrado em produção (HTTPS, fora de localhost/rede local).
- **Forçar atualização depois de um deploy:** aumente `CACHE_VERSION` em `sw.js` (ex.: `'v2'`) e publique.
  No próximo acesso o navegador instala o SW novo, que apaga os caches antigos. No aparelho,
  basta fechar o app por completo e abrir de novo. Se alguém ainda ficar preso: Chrome →
  Configurações do site → Limpar dados; ou, no desktop, DevTools → Application → Service Workers →
  Unregister.

## Estrutura

```
index.html            Início (dashboard)
jogadores.html        Jogadores (lista, filtros, detalhe, cadastro)
pagamentos.html       Pagamentos por mês
configuracoes.html    Mensalidade padrão, importar/exportar/backup e sair
importar.html         Importação da planilha antiga (colar/CSV → revisar → gravar)
login.html            Login
css/styles.css        Design system
js/config.js          URL e anon key do Supabase
js/db.js              Única camada que acessa o Supabase — retorna { data, error }
js/utils.js           Datas/meses (America/Sao_Paulo), dinheiro, telefone, WhatsApp, busca, HTML seguro
js/ui.js              Shell, toast, diálogos, chips, skeletons
js/payment-actions.js Atualização otimista + desfazer
js/import.js          Parser da planilha → plano de importação (funções puras)
js/export.js          CSV no formato da planilha antiga e backup JSON (funções puras)
js/pwa.js             Registro do service worker (só em produção)
sw.js                 Service worker network-first
manifest.webmanifest  Manifest do PWA
icons/                SVGs-fonte e PNGs do PWA
scripts/              gerar-icones.mjs
tests/                node --test
js/pages/*.js         Um script por tela
supabase/migrations/  SQL versionado
```

## Convenções

- `mes_referencia` é sempre a string `'YYYY-MM-01'`. Nunca use `new Date('YYYY-MM-DD')`.
- Todo HTML dinâmico passa por `` html`...` `` (escapa as interpolações) e `setHTML`.
- Jogadores nunca são apagados: inativar = `ativo = false`. Não há policy de DELETE.
