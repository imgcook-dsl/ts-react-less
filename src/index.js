module.exports = function (schema, option) {
  const { _, prettier } = option;
  const width = option.responsive.width || 750;
  const viewportWidth = option.responsive.viewportWidth || 375;
  const htmlFontsize = viewportWidth ? viewportWidth / 7.5 : null;

  // imports
  const imports = [`import React, { useState, useEffect } from 'react';`];

  // inline style
  const style = {};

  // Global Public Functions
  const utils = [];

  // Classes
  const classes = [];

  // 1vw = width / 100
  const _w = option.responsive.width / 100 || 750;

  const isExpression = (value) => {
    return /^\{\{.*\}\}$/.test(value);
  };

  const toString = (value) => {
    if ({}.toString.call(value) === '[object Function]') {
      return value.toString();
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, (key, value) => {
        if (typeof value === 'function') {
          return value.toString();
        } else {
          return value;
        }
      });
    }

    return String(value);
  };

  // flexDirection -> flex-direction
  const parseCamelToLine = (string) => {
    return string
      .split(/(?=[A-Z])/)
      .join('-')
      .toLowerCase();
  };
  // no unit style
  const noUnitStyles = ['opacity', 'fontWeight'];
  // box relative style
  const boxStyleList = [
    'fontSize',
    'marginTop',
    'marginBottom',
    'paddingTop',
    'paddingBottom',
    'height',
    'top',
    'bottom',
    'width',
    'maxWidth',
    'left',
    'right',
    'paddingRight',
    'paddingLeft',
    'marginLeft',
    'marginRight',
    'lineHeight',
    'borderBottomRightRadius',
    'borderBottomLeftRadius',
    'borderTopRightRadius',
    'borderTopLeftRadius',
    'borderRadius'
  ];

  // className structure support
  const generateLess = (schema) => {
    let strLess = '';

    function walk(json) {
      if (json.props.className) {
        let className = json.props.className;

        strLess += `.${className} {`;

        for (let key in style[className]) {
          let styleValue = parseStyle(style[className], { toREM: true })
          strLess += `${styleValue};\n`;
          console.log('strLess', strLess)
        }
      }

      if (json.children && json.children.length > 0) {
        json.children.forEach((child) => walk(child));
      }

      if (json.props.className) {
        strLess += '}';
      }
    }

    walk(schema);

    return strLess;
  };

  // convert to responsive unit, such as vw
  const parseStyle = (style, option = {}) => {
    const { toVW, toREM } = option;
    const styleData = [];
    for (let key in style) {
      let value = style[key];
      if (boxStyleList.indexOf(key) != -1) {
        if (toVW) {
          value = (parseInt(value) / _w).toFixed(2);
          value = value == 0 ? value : value + 'vw';
        } else if (toREM && htmlFontsize) {
          const valueNum = typeof value == 'string' ? value.replace(/(px)|(rem)/, '') : value;
          const fontSize = (valueNum * (viewportWidth / width)).toFixed(2);
          value = parseFloat((fontSize / htmlFontsize).toFixed(2));
          value = value ? `${value}rem` : value;
        } else {
          value = parseInt(value).toFixed(2);
          value = value == 0 ? value : value + 'px';
        }
        styleData.push(`${_.kebabCase(key)}: ${value}`);
      } else if (noUnitStyles.indexOf(key) != -1) {
        console.log('noUnitStyles-haskey', key);
        styleData.push(`${_.kebabCase(key)}: ${parseFloat(value)}`);
      } else {
        console.log('nokey', value)
        styleData.push(`${_.kebabCase(key)}: ${value}`);
      }
    }
    return styleData.join(';');
  };

  // parse function, return params and content
  const parseFunction = (func) => {
    const funcString = func.toString();
    const params = funcString.match(/\([^\(\)]*\)/)[0].slice(1, -1);
    const content = funcString.slice(funcString.indexOf('{') + 1, funcString.lastIndexOf('}'));
    return {
      params,
      content,
    };
  };

  // parse layer props(static values or expression)
  const parseProps = (value, isReactNode) => {
    if (typeof value === 'string') {
      if (isExpression(value)) {
        if (isReactNode) {
          return value.slice(1, -1);
        } else {
          return value.slice(2, -2);
        }
      }

      if (isReactNode) {
        return value;
      } else {
        return `'${value}'`;
      }
    } else if (typeof value === 'function') {
      const { params, content } = parseFunction(value);
      return `(${params}) => {${content}}`;
    }
  };

  // parse async dataSource
  const parseDataSource = (data) => {
    const name = data.id;
    const { uri, method, params } = data.options;
    const action = data.type;
    let payload = {};

    switch (action) {
      case 'fetch':
        if (imports.indexOf(`import {fetch} from whatwg-fetch`) === -1) {
          imports.push(`import {fetch} from 'whatwg-fetch'`);
        }
        payload = {
          method: method,
        };

        break;
      case 'jsonp':
        if (imports.indexOf(`import {fetchJsonp} from fetch-jsonp`) === -1) {
          imports.push(`import jsonp from 'fetch-jsonp'`);
        }
        break;
    }

    Object.keys(data.options).forEach((key) => {
      if (['uri', 'method', 'params'].indexOf(key) === -1) {
        payload[key] = toString(data.options[key]);
      }
    });

    // params parse should in string template
    if (params) {
      payload = `${toString(payload).slice(0, -1)} ,body: ${isExpression(params) ? parseProps(params) : toString(params)}}`;
    } else {
      payload = toString(payload);
    }

    let result = `{
      ${action}(${parseProps(uri)}, ${toString(payload)})
        .then((response) => response.json())
    `;

    if (data.dataHandler) {
      const { params, content } = parseFunction(data.dataHandler);
      result += `.then((${params}) => {${content}})
        .catch((e) => {
          console.log('error', e);
        })
      `;
    }

    result += '}';

    return `${name}() ${result}`;
  };

  // parse condition: whether render the layer
  const parseCondition = (condition, render) => {
    if (typeof condition === 'boolean') {
      return `${condition} && ${render}`;
    } else if (typeof condition === 'string') {
      return `${condition.slice(2, -2)} && ${render}`;
    }
  };

  // parse loop render
  const parseLoop = (loop, loopArg, render) => {
    let data;
    let loopArgItem = (loopArg && loopArg[0]) || 'item';
    let loopArgIndex = (loopArg && loopArg[1]) || 'index';

    if (Array.isArray(loop)) {
      data = toString(loop);
    } else if (isExpression(loop)) {
      data = loop.slice(2, -2);
    }

    // add loop key
    const tagEnd = render.match(/^<.+?\s/)[0].length;
    render = `${render.slice(0, tagEnd)} key={${loopArgIndex}}${render.slice(tagEnd)}`;

    // remove `this`
    const re = new RegExp(`this.${loopArgItem}`, 'g');
    render = render.replace(re, loopArgItem).replace(/this\./g, '');

    return `${data.replace(/this\./g, '')}.map((${loopArgItem}:any, ${loopArgIndex}:number) => {
      return (${render});
    })`;
  };

  // generate render xml
  const generateRender = (schema) => {
    const type = schema.componentName.toLowerCase();
    const className = schema.props && schema.props.className;
    const classString = className ? ` className={styles.${className}}` : '';

    if (className) {
      style[className] = schema.props.style;
    }

    let xml;
    let props = '';

    Object.keys(schema.props).forEach((key) => {
      if (['className', 'style', 'text', 'src'].indexOf(key) === -1) {
        props += ` ${key}={${parseProps(schema.props[key])}}`;
      }
    });

    switch (type) {
      case 'text':
        const innerText = parseProps(schema.props.text, true);
        xml = `<span${classString}${props}>${innerText}</span>`;
        break;
      case 'image':
        const source = parseProps(schema.props.src);
        xml = `<img${classString}${props} src={${source}} alt='' />`;
        break;
      case 'div':
      case 'page':
      case 'block':
      case 'component':
        if (schema.children && schema.children.length) {
          xml = `<div${classString}${props}>${transform(schema.children)}</div>`;
        } else {
          xml = `<div${classString}${props} />`;
        }
        break;
    }

    if (schema.loop) {
      xml = parseLoop(schema.loop, schema.loopArgs, xml);
    }
    if (schema.condition) {
      xml = parseCondition(schema.condition, xml);
    }
    if (schema.loop || schema.condition) {
      xml = `{${xml}}`;
    }

    return xml;
  };

  // 自定义组件名或者根据时间戳命名
  const myComponentName = schema.myComponentName || `${schema.componentName}${new Date().getTime()}`;

  // parse schema
  const transform = (schema) => {
    let result = '';

    if (Array.isArray(schema)) {
      schema.forEach((layer) => {
        result += transform(layer);
      });
    } else {
      const type = schema.componentName.toLowerCase();

      if (['page', 'block', 'component'].indexOf(type) !== -1) {
        // 容器组件处理: state/method/dataSource/lifeCycle/render
        const states = [];
        const lifeCycles = [];
        const methods = [];
        const init = [];
        const render = [`return (`];
        let classData = [`const ${myComponentName}:React.FC<${myComponentName}Props> = ({}) => { \n const [state, setState] = useState([])`];

        render.push(generateRender(schema));
        render.push(`)`);

        classData = classData
          .concat(states)
          .concat(lifeCycles)
          .concat(methods)
          .concat(render);
        classData.push('}');

        classes.push(classData.join('\n'));
      } else {
        result += generateRender(schema);
      }
    }

    return result;
  };

  if (option.utils) {
    Object.keys(option.utils).forEach((name) => {
      utils.push(`const ${name} = ${option.utils[name]}`);
    });
  }

  // start parse schema
  transform(schema);

  const prettierOpt = {
    parser: 'babel',
    printWidth: 120,
    singleQuote: true,
  };

  return {
    panelDisplay: [
      {
        panelName: `index.tsx`,
        panelValue: prettier.format(
          `
          'use strict';
          ${imports.join('\n')}
          import styles from './style.less';
          interface ${myComponentName}Props {};
          ${utils.join('\n')}
          ${classes.join('\n')}
          export default ${myComponentName};
        `,
          prettierOpt
        ),
        panelType: 'js',
      },
      {
        panelName: `index.less`,
        panelValue: prettier.format(generateLess(schema, style), {
          parser: 'less',
        }),
        panelType: 'less',
      }
    ],
    noTemplate: true,
  };
};
