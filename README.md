# EzTerminal PC Client

EzTerminal PC Client 是 EzTerminal 的开源电脑端。它运行在用户自己的 Mac 上，负责启动本机 Relay 和 Agent，并把本机 tmux 终端会话暴露给 EzTerminal 小程序连接。

这个仓库只包含 PC 端代码。小程序端、云函数和服务方后台不在这里。

## 快速开始

首次使用：

```bash
git clone https://github.com/cloudyc1/ezterminal-pc.git
cd ezterminal-pc
./link start
```

之后日常使用：

```bash
./link start
```

`./link start` 会自动检查本机环境，创建 `~/.ezterminal`，安装缺失的 npm 依赖，并启动 Relay + Agent。启动完成后终端会打印：

```text
Phone Relay: ws://你的局域网IP:8787/client
WeChat notify: disabled (not configured)
Bind code:   123456
Code expires: 2026-05-23T12:00:00.000Z
```

在 EzTerminal 小程序里填入 `Phone Relay` 地址并连接，然后输入 `Bind code` 完成绑定。绑定码默认 10 分钟过期；过期后运行 `./link restart` 获取新码。

如果只想执行安装启动，也可以运行：

```bash
./install.sh
```

## Requirements

- macOS
- Node.js 22+
- npm
- tmux

如果 `tmux` 缺失且电脑已经安装 Homebrew，`./link start` 会询问是否自动执行 `brew install tmux`。

Node.js 版本必须是 22 或更高，因为 Agent 使用 Node 原生 WebSocket。

## Commands

```bash
./link start      # check setup and start Relay + Agent
./link restart    # restart services and refresh bind code
./link stop       # stop services
./link status     # show status and bind code
./link doctor     # check local requirements
./link relay      # run only Relay in foreground
./link agent      # run only Agent in foreground
```

## 本地文件

PC Client 会把运行时配置写到本机用户目录：

```text
~/.ezterminal/
  config.env
  device.json
  bind-code
  bind-code-expires-at
  logs/
```

这些文件只属于当前电脑，不要提交到仓库。

常用配置在 `~/.ezterminal/config.env`：

```bash
RELAY_PORT=8787
BIND_CODE_TTL_SECONDS=600
RELAY_SESSION=ezterminal_relay
AGENT_SESSION=ezterminal_agent
```

如果你要在小程序挂起后继续收到微信订阅消息，把 CloudBase SDK 调用配置也写进这个本机文件：

```bash
TCB_ENV_ID=cloud1-你的环境
TENCENTCLOUD_SECRET_ID=你的SecretId
TENCENTCLOUD_SECRET_KEY=你的SecretKey
WECHAT_NOTIFY_FUNCTION=terminalNotify
```

这条链路不需要开 CloudBase HTTP 访问服务。`./link status` 或 `./link doctor` 显示下面这行才表示 PC Relay 会调用云函数发通知：

```text
WeChat notify: enabled (CloudBase SDK)
```

如果端口被占用，可以修改 `RELAY_PORT` 后重新运行：

```bash
./link restart
```

## 小程序绑定

1. 电脑和手机尽量连接同一个局域网。
2. 在电脑终端运行 `./link start`。
3. 打开 EzTerminal 小程序。
4. 输入终端显示的 `Phone Relay`。
5. 输入终端显示的 `Bind code`。
6. 进入终端页面后，可以在手机和电脑两端继续操作同一个 tmux 会话。

模拟器调试时可以使用：

```text
Simulator Relay: ws://127.0.0.1:8787/client
```

真机使用时必须使用 `Phone Relay` 里的局域网 IP。

## 日常维护

查看状态：

```bash
./link status
```

查看通知链路是否已配置：

```bash
./link doctor
tmux attach -t ezterminal_relay
```

Relay 日志里会显示每次云函数调用结果。`sent_count=0` 通常表示小程序还没点“开启通知”，或者一次性订阅额度已经被上一条通知消耗，需要重新授权。

重启并刷新绑定码：

```bash
./link restart
```

停止服务：

```bash
./link stop
```

环境诊断：

```bash
./link doctor
```

## 常见问题

### 手机连不上 Relay

- 确认手机和电脑在同一个 Wi-Fi。
- 确认小程序里填的是 `Phone Relay`，不是 `Simulator Relay`。
- macOS 防火墙如果提示 Node.js 接收入站连接，需要允许。
- 如果 IP 变化，重新运行 `./link status` 查看新的 `Phone Relay`。

### 电脑息屏后无法连接

PC 端服务运行在你的电脑上。电脑睡眠、断网或关机后，手机就无法继续连接。长期等待任务时建议：

- 接入电源。
- 系统设置里临时关闭自动睡眠。
- 保持网络在线。

### npm 依赖安装失败

先确认 Node.js 和 npm：

```bash
node --version
npm --version
```

如果网络环境需要代理，请先在当前终端配置代理，再运行：

```bash
./link start
```

### tmux 缺失

安装 Homebrew 后执行：

```bash
brew install tmux
```

然后重新运行：

```bash
./link start
```
