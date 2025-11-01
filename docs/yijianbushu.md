
## 一键部署指南

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/idinging/freemail)

#### 1. 首先点击  Deploy to Cloudflare

#### 2 登陆账号后会进入，推荐选择亚洲地区（当然不选择亚洲也没关系）
`不要修改数据库名称和R2名称 可能导致无法查询`
![5a0cc80913848aca4b5f4058538ad6aa|690x333](../pic/v4/depl1.png)
#### 3. 点击创建部署，然后耐心等待克隆部署
![5a0cc80913848aca4b5f4058538ad6aa|690x333](../pic/v4/depl2.png)

#### 4. 点击继续处理项目，绑定必须的环境变量
![5a0cc80913848aca4b5f4058538ad6aa|690x333](../pic/v4/depl.png)

![5a0cc80913848aca4b5f4058538ad6aa|690x333](../pic/v4/depl5.png)


#### 5. 添加完成后点击部署即可

    `注：这三个变量是必须的，其他变量例如 管理员名称，发邮件密钥可自行决定是否添加`

    最后就可以打开对应的worker连接登陆了

![5a0cc80913848aca4b5f4058538ad6aa|690x333](../pic/v4/depl5.jpeg)

#### 6. 默认管理员账号为 admin


#### 7. 记得将域名邮箱的catch-all 绑定到worker上（不绑定无法接收到邮件）
![5a0cc80913848aca4b5f4058538ad6aa|690x333](../pic/v4/depl6.png)
