<template>
  <div class="cms-auth-shell">
    <div class="cms-auth-ambient" aria-hidden="true">
      <span />
      <span />
    </div>

    <header class="cms-auth-topbar">
      <NuxtLink
        class="cms-auth-brand"
        to="/"
      >
        <img src="https://cdn.sdutvincirobot.top/site-assets/images/logo-e355a71c.webp" alt="">
        <span>
          <strong>山理工 Vinci 机器人队</strong>
          <small><span aria-hidden="true">←</span> 返回官方网站</small>
        </span>
      </NuxtLink>
      <p class="cms-auth-system-mark">
        <span>VINCI</span>
        TEAM OPERATIONS
      </p>
    </header>

    <main class="cms-auth-main">
      <slot />
    </main>

    <footer class="cms-auth-footer">
      <span>SDUT · ROBOCON</span>
      <span>CONTENT SYSTEM / 2026</span>
    </footer>
  </div>
</template>
