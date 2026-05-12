---
title: "C语言 和 C++ 的I/O"
---

1.C语言的stdio.h中的scanf和printf

**int scanf(const char \*format, ...)** 函数从标准输入流 **stdin** 读取输入，并根据提供的 **format** 来浏览输入。

**int printf(const char \*format, ...)** 函数把输出写入到标准输出流 **stdout ，并根据提供的格式产生输出。

```C
printf("输出内容(可含占位符)"，变量1，变量2)

printf("%d",a);      //输出一个整形变量a
printf("%f %f",a,b);   //输出二个单精度浮点数变量(fp32) a，b中间以空格隔开
printf("%d序号对应的值是%lf",a,b);   //输出二个单精度浮点数变量a，b中间以空格隔开
printf("%.2f",a);   //输出一个单精度浮点数(fp32) a,并保留两位小数
printf("你好")  //输出“你好”字符串
```

```cpp
scanf("%d",&a);           //输入一个整形数
scanf("%d %d",&a，&b);   //输入两个整形数，中间以空格隔开      
scanf("%d,%d",&a，&b);   //输入两个整形数，中间以逗号隔开
```

2.C++的iostream中的std::cin和std::cout

**cout** 是与流插入运算符 << 结合使用

```cpp
std::cout << a;   //输出一个变量a
std::cout << "你好"   //输出"你好"
std::cout << "结果是：" << a << std::endl  //输出 结果是: a  并换行
```

**cin** 是与流提取运算符 >> 结合使用

```cpp
std::cin >> a     //输入一个变量a
```

![](https://cdn.tungchiahui.cn/tungwebsite/assets/images/2023/10/05/image2.webp)
