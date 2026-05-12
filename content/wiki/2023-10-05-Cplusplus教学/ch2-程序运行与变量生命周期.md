---
title: "程序运行与变量生命周期"
---

### 代码运行思路
从main函数开始，代码是一行一行运行的。（一个工程里有且只有一个main函数）

![](https://cdn.tungchiahui.cn/tungwebsite/assets/images/2023/10/05/image1.webp)

### 生命周期
1.  **局部变量：**

    1.  位置：在某个函数或块的内部声明的变量称为局部变量。

    2.  作用域：它们只能被该函数或该代码块内部的语句使用。局部变量在函数外部是不可知的。

```cpp
#include <stdio.h>

 int add(int a,int b);

int main ()
{
  /* 局部变量声明 */
  int a, b;
  int c;

  /* 实际初始化 */
  a = 10;
  b = 20;
  c = add(a,b);

  printf ("value of a = %d, b = %d and c = %d\n", a, b, c);

  return 0;
}

int add(int x,int y)
{
    int z = x + y;
    return z;
}
```

2.  全局变量

    1.  位置：全局变量是定义在函数外部，通常是在程序的顶部。

    2.  作用域：全局变量在整个程序生命周期内都是有效的，在任意的函数内部能访问全局变量。

```cpp
#include <stdio.h>

/* 全局变量声明 */
int g;

int main ()
{
  /* 局部变量声明 */
  int a;

  /* 静态(全局)变量声明 */
  static int b;

  /* 实际初始化 */
  a = 10;
  b = 20;
  g = a + b;

  printf ("value of a = %d, b = %d and g = %d\n", a, b, g);

  return 0;
}
```

在程序中，局部变量和全局变量的名称可以相同，但是在函数内，如果两个名字相同，会使用局部变量值，全局变量不会被使用。

```cpp
#include <stdio.h>

 void tset();
/* 全局变量声明 */
int g = 20;

int main ()
{
  /* 局部变量声明 */
  int g = 10;

  printf ("value of g = %d\n",  g);

  test();

  return 0;
}

void test()
{
    printf("value of g = %d\n",g);
}
```

### 内存四区
暂时无法在飞书文档外展示此内容

1.  **静态存储区（全局区）** ：可以分为rodata区data区和bss区，已经初始化的只读常量被放在rodata,已经被初始化的非零变量被放在data区;没有被初始化的或者值为零的变量被放在bss区，通常默认初始化为 0(表示数字的数据类型)，'\\0'(char类型) 和 NULL(指针类型)。

2.  **栈区（stack）** ：局部变量被存放在该区，如果不初始化局部变量，那么局部变量是随机值。容量很小。

3.  **堆区（heap）** ：由程序员开辟内存空间给变量，由程序员分配和释放，如果程序员不进行释放内存，则会内存泄漏，当程序结束后，系统会帮忙释放没有被释放的内存。

4.  **代码区** ：存放 CPU 执行的机器指令，通常是只读的。
