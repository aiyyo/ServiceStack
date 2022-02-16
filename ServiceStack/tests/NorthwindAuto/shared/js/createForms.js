import { resolve, humanify } from "@servicestack/client"
import { Types } from "./Types"
import { Forms } from "../../ui/js/appInit";
/*minify:*/

/** @typedef {{namespace:string,name:string}} TypeRef
    @typedef {{name:string,genericArgs:string[]}} MetaType */

/** @param {{[op:string]:MetadataType}} TypesMap
 *  @param {ApiCss} css 
 *  @param {ThemeCss} theme */
export function createForms(TypesMap, css, theme) {
    let useType = type => (acc,x) => { acc[x]=type; return acc }
    let InputTypes = {
        bool: 'checkbox',
        ...'DateTime,DateTimeOffset,DateOnly'.split(',').reduce(useType('date'), {}),
        ...'TimeSpan,TimeOnly'.split(',').reduce(useType('time'), {}),
        ...'byte,short,int,long,ushort,uint,ulong,float,double,decimal'.split(',').reduce(useType('number'), {}),
        ...'string,Guid,Uri'.split(',').reduce(useType('text'), {}),
    }
    
    let _id = 0;
    let inputId = input => input && (input.id || `__${input.type||'undefined'}${_id++}`)
    let colClass = fields => `col-span-12` + (fields === 2 ? ' sm:col-span-6' : fields === 3 ? ' sm:col-span-4' : fields === 4 ? ' sm:col-span-3' : '')

    function inputType(typeName) {
        if (!typeName) return null
        typeName = Types.unwrap(Types.alias(typeName))
        return InputTypes[typeName]
    }
    function inputProp(prop) {
        let id = toCamelCase(prop.name), idLower = id.toLowerCase()
        let propType = Types.unwrap(Types.typeName2(prop.type, prop.genericArgs))
        let input = { id, type:inputType(propType), 'data-type': prop.type }
        if (prop.genericArgs) input['data-args'] = prop.genericArgs.join(',')
        let type = TypesMap[propType]
        if (type && type.isEnum) {
            input.type = 'select'
            if (type.enumValues) {
                input.allowableEntries = []
                for (let i=0; i<type.enumNames; i++) {
                    input.allowableEntries.push({ key:type.enumValues[i], value:type.enumNames[i] })
                }
            } else {
                input.allowableValues = type.enumNames
            }
        } else if (idLower.indexOf('password') >= 0) {
            input.type = 'password'
        } else if (idLower === 'email') {
            input.type = 'email'
        } else if (idLower.endsWith('url')) {
            input.type = 'url'
        }
        if (prop.input)
            Object.assign(input, prop.input)
        return input
    }

    return {
        inputId,
        colClass,
        inputProp,
        theme,
        formClass: theme.form + (css.form ? ' ' + css.form : ''),
        gridClass: css.fieldset,
        /** @param {InputInfo[]} formLayout */
        getGridInputs(formLayout) {
            let to = []
            if (formLayout) {
                formLayout.forEach(input => {
                    let id = inputId(input)
                    if (id.startsWith('__')) console.log(`!id ${id}`, input) /*debug*/
                    to.push({ id, input, rowClass: input.css && input.css.field || css.field })
                })
            }
            return to
        },
        getFieldError(error, id) { return error && error.errors &&
            map(error.errors.find(x => x.fieldName.toLowerCase() === id.toLowerCase()), x => x.message)
        },
        kvpValues(input) {
            return input.allowableEntries || (input.allowableValues||[]).map(x => ({ key:x, value:x }))
        },
        useLabel(input) {
            return input.label != null ? input.label : humanify(input.id)
        },
        usePlaceholder(input) {
            return input.placeholder || ''
        },
        isRequired(input) {
            return input.required || false
        },

        /** @param {MetadataOperationType} op */
        resolveFormLayout(op) {
            if (!op) return null
            let allProps = typeProperties(op.request).filter(Forms.supportsProp)
            if (op.ui.formLayout) {
                let allPropsMap = allProps.reduce((acc,x) => { acc[x.name] = x; return acc }, {})
                let ret = op.ui.formLayout.map(input => ({ ...inputProp(allPropsMap[input.id]), ...input }) )
                return ret
            }
            let inputProps = allProps.map(inputProp)
            let fullWidthTypes = ['textarea','divider']
            /** @param {InputInfo} input */
            let configureCss = input => {
                if (input && (fullWidthTypes.indexOf(input.type) >= 0 || input['data-type'] === 'List`1')) {
                    if (!input.css) input.css = {}
                    if (!input.css.field) input.css.field = `col-span-12`
                }
                return input
            }
            let pagingStart = inputProps.findIndex(x => x.id.toLowerCase() === 'skip')
            if (pagingStart >= 0) inputProps.splice(pagingStart, 0, { id:`__divider${pagingStart}`, type:'divider' })
            let formLayout = inputProps.map(configureCss)
            return formLayout
        },
        formValues(form) {
            let obj = {}
            Array.from(form.elements).forEach(el => {
                if (!el.id || el.value == null || el.value === '') return
                let dataType = el.getAttribute('data-type')
                let dataArgs = (el.getAttribute('data-args') || '').split(','), dataArg = dataArgs[0]
                let value = el.type === 'checkbox'
                    ? el.checked
                    : el.value
                if (Types.isNumber(dataType) || (dataType === 'Nullable`1' && Types.isNumber(dataArg))) {
                    value = Number(value)
                } else if (dataType === 'List`1') {
                    value = value.split(',').map(x => Types.isNumber(dataArg)
                        ? Number(x)
                        : x)
                }
                obj[el.id] = value
            })
            return obj
        },
        groupTypes(allTypes) {
            let allTypesMap = {}
            let groups = []
            allTypes.forEach(type => {
                if (allTypesMap[type.name]) return
                let group = []
                let addTypeDef = typeDef => {
                    if (!typeDef || allTypesMap[typeDef.name]) return
                    allTypesMap[typeDef.name] = typeDef
                    group.push({ type: typeDef, typeName: Types.typeName(typeDef) })
                }
                let addTypeRef = typeRef => {
                    if (!typeRef || allTypesMap[typeRef.name]) return
                    let typeDef = TypesMap[typeRef.name]
                    allTypesMap[typeDef.name] = typeDef
                    group.push({ type: typeDef, typeName: Types.typeName(typeRef) })
                    return typeDef
                }
                addTypeDef(type)
                if (type.inherits) {
                    let subType = addTypeRef(type.inherits)
                    while (subType) {
                        subType = subType.inherits ? addTypeRef(subType.inherits) : null
                    }
                }
                groups.push(group)
            })
            return groups
        },
        supportsProp(prop) {
            let propType = Types.typeName2(prop.type, prop.genericArgs)
            if (prop.isValueType || prop.isEnum || inputType(propType))
                return true
            if (prop.type === 'List`1' && inputType(prop.genericArgs[0]))
                return true
            console.log('!supportsProp', 'propType', propType, prop.type, prop.genericArgs, inputType(prop.genericArgs[0])) /*debug*/
            return false
        },
        populateModel(model, formLayout) {
            if (!model || !formLayout) return null
            formLayout.forEach(input => {
                if (typeof model[input.id] == 'undefined') {
                    model[input.id] = null
                }
            })
            return model
        }
    }
}

/*:minify*/