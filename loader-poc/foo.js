// import {hello} from './foo.st.css'

import('./foo.st.css').then((m) => {
  console.log('lala!', m.classes)

  document.body.innerHTML = `<div class="${m.classes.hello}"></div>`

})

// console.log(hello)
