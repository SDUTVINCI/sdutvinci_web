---
title: "联合体（共用体）"
---

**共用体** 是一种特殊的数据类型，允许您在相同的内存位置存储不同的数据类型。您可以定义一个带有多成员的共用体，但是任何时候只能有一个成员带有值。共用体提供了一种使用相同的内存位置的有效方式。

### 定义共用体
为了定义共用体，您必须使用 **union** 语句，方式与定义结构类似。union 语句定义了一个新的数据类型，带有多个成员。union 语句的格式如下：

```cpp
union [union tag]
{
   member definition;
   member definition;
   ...
   member definition;
} [one or more union variables];
```
```cpp
//举例：
union Type_Name
{
   int i;
   float f;
   char str1[20];
   string str2;
} object_name;

//调用方式
object_name.i = 5;
object_name.f = 6.0f;
object_name.str2 = "你好！";
```

注意：共用体所占内存大小，按成员变量需占内存最大的来。
