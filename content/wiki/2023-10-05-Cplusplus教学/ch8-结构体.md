---
title: "结构体"
---

### 定义结构体
结构体定义由关键字 **struct** 和结构体名组成，结构体名可以根据需要自行定义。

struct 语句定义了一个包含多个成员的新的数据类型，struct 语句的格式如下：

```cpp
struct type_name {
member_type1 member_name1;
member_type2 member_name2;
member_type3 member_name3;
.
.
} object_names;
```

### 访问结构体成员
下面是声明一个结构体类型 **Books** ，变量为 **book，** 为了访问结构的成员，我们使用 **成员访问运算符（.）** 。成员访问运算符是结构变量名称和我们要访问的结构成员之间的一个句号。

```cpp
struct Books
{
   char  title[50];
   char  author[50];
   char  subject[100];
   int   book_id;
} book;

book.book_id = 1;
strcpy(book.title,"春天");
```

```cpp
typedef struct Books //Books可忽略不写
{
   char  title[50];
   char  author[50];
   char  subject[100];
   int   book_id;
}Books_Rename;

struct Books book;   //第一种写法,不使用typedf必须加 struct 定义结构体
Books_Rename book;   //用typedef后的写法，9,11行不能共存，因为变量名相同。

book.book_id = 1;0
strcpy(book.title,"春天");
```

### 指向结构的指针
您可以定义指向结构的指针，方式与定义指向其他类型变量的指针相似，如下所示：

```cpp
struct Books *struct_pointer;
```

现在，您可以在上述定义的指针变量中存储结构变量的地址。为了查找结构变量的地址，请把 & 运算符放在结构名称的前面，如下所示：

```cpp
struct_pointer = &Book1;
```

为了使用指向该结构的指针访问结构的成员，您必须使用 -> 运算符，如下所示：

```cpp
struct_pointer->title;
(*struct_pointer).title;
```

### 结构体与函数
1.  作为函数参数

```cpp
struct Books
{
    ···
    int   book_id;
} book;

void fun1(Books book){
}
//通常使用指针传递
void fun2(Books *book){
}
```

2.  作为函数返回类型

### C++中的结构体
1.  定义 与上述定义一致，不同的是，在 C++ 中即使不使用 typedef struct 来定义结构体，定义结构体变量时也无需在变量前加 struct

```cpp
//定义结构体
struct Books
{
   char  title[50];
   char  author[50];
   char  subject[100];
   int   book_id;
};
//定义结构体变量
book book1;
```

2.  面向对象 `struct` 默认的成员和继承是 `public`

```cpp
struct Books
{
  public://默认
    string title;
    string author;
    string subject;
    int    book_id;
  //构造函数
   Books(string t,string author,string subject,int id){
        title = t;
        author = author;
        subject = subject;
        book_id = id;
   }
   //析构函数
   ~Books(){
    ...
   }
  //成员函数
  void fun1(){
   ...
  }
   private:
   protected:
};
//初始化结构体
Books book1("title","author","subject",1);
```
