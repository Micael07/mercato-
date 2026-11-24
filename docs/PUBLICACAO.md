# Publicar o Mercato (só com tablet) e vender o acesso

Fluxo: **GitHub** (guarda o código) → **Neon** (banco) → **Render** (site no ar). Tudo pelo navegador do tablet. Não precisa de computador, Node.js nem terminal local.

> Dica: nos três sites, se algum botão não aparecer, ative **“Versão para computador / Desktop site”** no menu do navegador.

## 0. O que você vai ter no final

- Um endereço `https://NOME.onrender.com` com o Mercato.
- Um menu **Sistema → Clientes e licenças** que só **você** enxerga. Nele você libera, renova e bloqueia o acesso de cada cliente.
- Cliente novo que se cadastra entra como **“Aguardando liberação”** e não acessa nada até você liberar.

## 1. Contas e segurança (10 min)

Crie contas gratuitas, **ative a verificação em duas etapas** em todas e guarde as senhas num gerenciador:

1. GitHub — https://github.com/signup
2. Neon — https://console.neon.tech/
3. Render — https://dashboard.render.com/ (entre com o GitHub)

Tenha à mão o **e-mail que será o seu login de dono do sistema**. Ele vira a variável `PLATFORM_ADMIN_EMAILS`. Só esse e-mail enxerga “Clientes e licenças”.

## 2. Enviar o código para o GitHub (privado)

O arquivo **`mercato-final.zip`** (entregue no chat) tem o projeto completo. Baixe-o no tablet.

**Caminho A: Codespaces (navegador, gratuito)**

1. GitHub → **+** → **New repository**. Nome: `mercato-erp`. Marque **Private** e **Add a README file**. **Create repository**.
2. Na página do repositório: **Code → Codespaces → Create codespace on main**. Abre um VS Code dentro do navegador (leva ~1 min).
3. No painel de arquivos (esquerda), toque e segure/clique com o botão direito em uma área vazia → **Upload…** → escolha `mercato-final.zip`.
4. Abra o terminal (menu ☰ → **Terminal → New Terminal**) e rode, uma linha por vez:

```sh
unzip -o mercato-final.zip && rm mercato-final.zip
ls package.json render.yaml
git status --short | grep -i "env"
```

   - O `ls` deve mostrar os dois arquivos **na raiz** (não dentro de uma pasta).
   - O `grep` deve mostrar **no máximo** `.env.example`. Se aparecer `.env`, `.env.local` ou parecido, **não continue**: apague o arquivo e rode de novo.

5. Envie:

```sh
git add -A && git commit -m "Mercato" && git push
```

6. Confira no GitHub (aba **Code**) que `package.json` e `render.yaml` aparecem na raiz do repositório.
7. Volte ao GitHub → **Codespaces** (github.com/codespaces) → **⋯ → Delete** no codespace, para não gastar horas gratuitas.

**Caminho B (mais curto):** conecte o GitHub em *Claude → Configurações → Conectores*, crie o repositório privado `mercato-erp` com README e peça no chat para eu enviar o código. Não é necessário o Codespaces.

## 3. Criar o banco no Neon

1. Neon → **New Project**. Nome `mercato`, plano **Free**, região próxima do Render (ex.: *US East*).
2. Abra **Connect**. Você vai copiar **duas** URLs do **mesmo banco** (tocar em *Copy snippet* ou selecionar o texto):
   - **URL A (aplicativo):** com **Connection pooling LIGADO**. O host tem `-pooler`.
   - **URL B (migrations):** com **Connection pooling DESLIGADO**. O host **não** tem `-pooler`.
3. Nas **duas**, troque `sslmode=require` por **`sslmode=verify-full`**. Se a URL tiver mais parâmetros depois de `?`, separe com `&` e **não repita** `sslmode`.
4. Guarde as duas em local seguro (gerenciador de senhas). Elas dão acesso total ao banco: nunca coloque no GitHub nem em conversa.

## 4. Publicar no Render

1. Render → **New + → Blueprint** → conecte o GitHub e autorize **somente** o repositório `mercato-erp`.
2. Branch `main`; o arquivo detectado deve ser `render.yaml`. Nomeie o Blueprint (`mercato`).
3. O Render pede três valores:

| Campo | O que colar |
| --- | --- |
| `DATABASE_URL` | URL A (pooled) |
| `MIGRATION_DATABASE_URL` | URL B (direta) |
| `PLATFORM_ADMIN_EMAILS` | seu e-mail de dono (pode listar mais de um, separados por vírgula) |

4. Confira que será criado **um Web Service no plano Free** e nenhum banco do Render. **Apply**.
5. Abra **Logs** do serviço. O build instala, valida a configuração, **cria as tabelas no Neon** (`Aplicada: 001…005`) e compila. Leva alguns minutos. Termina em **Live**.
6. O endereço `https://….onrender.com` aparece no topo do serviço. Esse é o link do seu sistema.

Se o build falhar, a mensagem aponta a variável faltando (ex.: “use a conexão DIRETA”). Corrija em **Environment** e use **Manual Deploy → Deploy latest commit**.

## 5. Criar a sua conta de dono (faça logo após o deploy)

1. Abra `https://SEU-ENDERECO/api/health`: deve mostrar `{"ok":true}`.
2. Abra `/register` e cadastre-se **com o e-mail de `PLATFORM_ADMIN_EMAILS`**, uma senha forte e os dados da sua própria empresa. Essa conta entra liberada, sem vencimento.
3. Entre. Em **Sistema** deve aparecer **Clientes e licenças**.

> Faça isto antes de divulgar o link. Se outra pessoa cadastrar o seu e-mail primeiro, ela vira dona do sistema. Nesse caso, apague o serviço, o banco e recomece.

## 6. Dia a dia: vender e liberar o acesso

**Cliente se cadastra sozinho (`/register`)**
1. Passe o link `https://SEU-ENDERECO/register` ao cliente.
2. Ele cria a conta e vê “Cadastro recebido”. Não consegue entrar ainda.
3. Você recebe o pagamento por fora (PIX, etc.).
4. **Sistema → Clientes e licenças** → filtro **Aguardando liberação** → **Liberar** → **+30 dias** (ou 90 dias / 12 meses). Pode anotar o pagamento (“PIX 23/11”), que fica no histórico.

**Você cadastra o cliente**
**Novo cliente** → dados da empresa e do administrador, plano e dias. O sistema mostra o e-mail e a **senha provisória uma única vez**: copie e envie ao cliente.

**Renovar:** abra o cliente → **+30 dias**. Soma a partir do vencimento atual (ou de hoje, se já venceu).
**Bloquear:** **Bloquear acesso agora**. Vale na hora, até para quem está logado. **Reativar acesso** desfaz.
**Esqueceu a senha:** **Gerar senha provisória** (o sistema não envia e-mail). Encerra as sessões abertas dele.
**Aviso de vencimento:** nos 7 últimos dias o cliente vê uma faixa amarela. Vencida a licença, o login informa que precisa regularizar. Para exibir o seu WhatsApp nessa mensagem, adicione em **Environment** a variável `NEXT_PUBLIC_SUPPORT_CONTACT` (ex.: `WhatsApp (92) 9xxxx-xxxx`) e faça um novo deploy.

Só quem está em `PLATFORM_ADMIN_EMAILS` acessa essa área. Clientes não criam empresas nem alteram a própria licença. Tudo fica registrado no histórico e na auditoria.

## 7. Atualizar o sistema

Peça a nova versão no chat. Para aplicar: Codespaces (passo 2) → `unzip -o` por cima → `git add -A && git commit -m "Atualização" && git push`. O Render publica sozinho e aplica as migrations novas. Se algo der errado: Render → **Events → Rollback** volta o **código**, não o banco.

## 8. Limites do plano gratuito: leia antes de cobrar

- **Render Free** “dorme” após 15 min sem uso (primeiro acesso demora ~1 min) e o próprio Render não recomenda para produção. Para clientes pagantes, use um plano pago do Render.
- **Neon Free** tem cotas de armazenamento e de uso. Verifique no painel e passe para um plano pago antes de crescer.
- **Backups:** configure e teste a restauração no Neon. Não presuma backup automático por tempo ilimitado.
- **Sem e-mail automático:** recuperação de senha e convites não são enviados. Use a senha provisória (seção 6) e links de convite manuais.
- **Sem nota fiscal:** o PDV emite comprovante não fiscal.
- **Cobrança é manual:** o sistema não recebe pagamentos. Você confirma e libera.
- Antes de operar com dados reais de clientes, passe pelo `docs/CHECKLIST_PRODUCAO.md` (isolamento entre empresas no banco, revisão de APIs, backups, LGPD).

## 9. Erros comuns

| Sintoma | O que fazer |
| --- | --- |
| Build: “use a conexão DIRETA (sem -pooler)” | `MIGRATION_DATABASE_URL` precisa ser a URL B (pooling desligado). |
| Build: “use sslmode=verify-full” | Troque `sslmode=require` por `sslmode=verify-full` na URL. |
| Build: “Defina PLATFORM_ADMIN_EMAILS” | Adicione o seu e-mail em **Environment**. |
| `relation … does not exist` | As migrations não rodaram: confira o log do build e a `MIGRATION_DATABASE_URL`. |
| `/register` entra, mas “Clientes e licenças” não aparece | Você cadastrou com e-mail diferente do `PLATFORM_ADMIN_EMAILS`. |
| Cliente liberado ainda não entra | Confira se a situação é **Ativa** e o vencimento é futuro. |
| Site demora no primeiro acesso | Render Free acordando; espere ~1 min. |
| `git push` pede login | No Codespaces já está autenticado; confira se está no terminal do Codespace. |
| Erro de CSRF/origem | Acesse sempre pelo endereço HTTPS do Render. |

Ao pedir ajuda, mande só a mensagem de erro. **Nunca** envie URLs do banco, senhas ou `AUTH_SECRET`.
