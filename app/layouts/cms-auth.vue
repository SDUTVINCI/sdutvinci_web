<template>
  <div class="cms-auth-shell">
    <NuxtLink
      class="cms-auth-brand"
      to="/"
    >
      <img src="/images/logo.png" alt="">
      <span>
        <strong>山理工 Vinci 机器人队</strong>
        <small>返回官方网站</small>
      </span>
    </NuxtLink>
    <main class="cms-auth-main">
      <slot />
    </main>
  </div>
</template>
