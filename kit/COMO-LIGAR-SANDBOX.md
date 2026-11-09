# Sandbox do Electron no Linux

O app é feito em Electron (o mesmo motor do Chrome). No Linux, o "sandbox" do Chrome isola as telas do app
do resto do sistema. Ele só funciona se o arquivo `chrome-sandbox` pertencer ao root com permissão especial.

Sem isso, o `kit/iniciar.sh` abre o app com `--no-sandbox` e avisa. Funciona, mas com menos isolamento.
Para ligar o sandbox (uma vez, depois de cada `npm ci`):

```sh
cd app/node_modules/electron/dist
sudo chown root:root chrome-sandbox
sudo chmod 4755 chrome-sandbox
```

Na próxima abertura o aviso some. Numa VPS, faça o mesmo depois do `kit/vps/instalar-vps.sh`.
